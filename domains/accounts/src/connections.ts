import { Sealed } from "@notus/cloudflare/sealed";
import { ConnectionDb } from "@notus/db/connection";
import { Backend } from "@notus/openai/backend";
import { Device } from "@notus/openai/device";
import { OAuth } from "@notus/openai/oauth";
import {
  ForwardRequest,
  ForwardResponse,
  Provider,
  TokenSet,
  replayable,
} from "@notus/openai/types";
import { eq, lt } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import { ConnectionError } from "./errors";
import { connections, deviceLogins, forwards } from "@notus/db/schema/connection";
import { ConnectionRow, DeviceLoginRow, ForwardRow } from "./rows";

const Millis = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** An explicit link by the user (or the harness). Possession of a login file is not a link. */
export const Seed = Schema.Union([
  Schema.Struct({
    userId: Schema.NonEmptyString,
    provider: Schema.Literal("openai-chatgpt"),
    tokens: TokenSet,
    fingerprint: Schema.NonEmptyString,
  }),
  Schema.Struct({
    userId: Schema.NonEmptyString,
    provider: Schema.Literal("openai-api"),
    key: Schema.NonEmptyString,
    fingerprint: Schema.NonEmptyString,
  }),
]);
export type Seed = typeof Seed.Type;
export const ConnectionStatus = Schema.Struct({
  userId: Schema.NonEmptyString,
  provider: Provider,
  linked: Schema.Boolean,
  accountId: Schema.NullOr(Schema.NonEmptyString),
  expiresAt: Schema.NullOr(Millis),
  linkedAt: Schema.NullOr(Millis),
  rotatedAt: Schema.NullOr(Millis),
  revokedAt: Schema.NullOr(Millis),
  /** Hash of the explicit seed that supplied the material; never the material itself. */
  seedFingerprint: Schema.NullOr(Schema.NonEmptyString),
});
export interface ConnectionStatus extends Schema.Schema.Type<typeof ConnectionStatus> {}
/** Where a device-code sign-in stands; the code and page are what the person needs to finish it. */
export const DeviceLogin = Schema.Union([
  Schema.Struct({
    state: Schema.Literal("pending"),
    userCode: Schema.NonEmptyString,
    verificationUrl: Schema.NonEmptyString,
    expiresAt: Millis,
    /** Seconds until the next poll makes sense. */
    interval: Schema.Int,
  }),
  Schema.Struct({ state: Schema.Literal("linked"), connection: ConnectionStatus }),
  Schema.Struct({ state: Schema.Literal("expired") }),
  Schema.Struct({ state: Schema.Literal("none") }),
]);
export type DeviceLogin = typeof DeviceLogin.Type;
export const AgentLogin = Schema.Struct({
  access: Schema.NonEmptyString,
  idToken: Schema.NonEmptyString,
  accountId: Schema.NonEmptyString,
  expiresAt: Millis,
});
export interface AgentLogin extends Schema.Schema.Type<typeof AgentLogin> {}

// Renew shortly before expiry so a forwarded request never races the deadline.
const refreshWindow = 5 * 60_000;
const forwardRetention = 24 * 60 * 60_000;
const fail = (reason: ConnectionError["reason"]) => new ConnectionError({ reason });

/**
 * One user's saved model logins: link, status, revoke, authorized forwarding, agent logins and the
 * device-code sign-in. The Durable Object host serializes these calls; refresh therefore never
 * races itself. Provider material is opened here and nowhere else. forward returns provider
 * responses, never credentials, and replays an identical operation without a second provider call.
 */
export interface Interface {
  readonly status: (
    userId: string,
  ) => Effect.Effect<ReadonlyArray<ConnectionStatus>, ConnectionError>;
  readonly link: (seed: Seed) => Effect.Effect<ConnectionStatus, ConnectionError>;
  readonly revoke: (
    userId: string,
    provider: Provider,
    now: number,
  ) => Effect.Effect<ConnectionStatus, ConnectionError>;
  /**
   * One operator model request on the user's platform API key. gate serializes the local
   * decisions (replay lookup, record) with every other call on this connection; the provider
   * round trip itself runs outside it.
   */
  readonly forward: (
    userId: string,
    operationId: string,
    request: ForwardRequest,
    gate: <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<A, E>,
  ) => Effect.Effect<ForwardResponse, ConnectionError>;
  /**
   * A fresh subscription login for an agent process on the user's dev box. The refresh token never
   * leaves; the caller serializes this with every other call on the connection.
   */
  readonly agentLogin: (
    userId: string,
    minimumLifetimeMs: number,
  ) => Effect.Effect<AgentLogin, ConnectionError>;
  /** Starts a device-code sign-in, replacing any unfinished one. */
  readonly beginDeviceLogin: (userId: string) => Effect.Effect<DeviceLogin, ConnectionError>;
  /** Asks the issuer once whether the person finished; links the login when they did. */
  readonly pollDeviceLogin: (userId: string) => Effect.Effect<DeviceLogin, ConnectionError>;
}
export class Service extends Context.Service<Service, Interface>()("@notus/accounts/Connections") {}

export const layerNoDeps = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = yield* ConnectionDb.Service;
    const http = yield* HttpClient.HttpClient;
    const sealed = yield* Sealed.Service;
    const crypto = yield* Crypto.Crypto;

    const storage = <A, E>(effect: Effect.Effect<A, E>) =>
      effect.pipe(
        Effect.mapError((error) =>
          Schema.is(ConnectionError)(error)
            ? error
            : fail(Schema.isSchemaError(error) ? "invalid-input" : "storage"),
        ),
      );

    const seal = (text: string) => sealed.seal(text).pipe(Effect.mapError(() => fail("storage")));
    const open = (text: string) => sealed.open(text).pipe(Effect.mapError(() => fail("storage")));

    const fingerprintOf = (material: string) =>
      crypto.digest("SHA-256", new TextEncoder().encode(material)).pipe(
        Effect.map(Hex.encode),
        Effect.mapError(() => fail("storage")),
      );

    const project = (row: ConnectionRow): ConnectionStatus => ({
      userId: row.userId,
      provider: row.provider,
      linked: row.revokedAt === null,
      accountId: row.accountId === "" ? null : row.accountId,
      expiresAt: row.provider === "openai-chatgpt" ? row.expiresAt : null,
      linkedAt: row.linkedAt,
      rotatedAt: row.rotatedAt,
      revokedAt: row.revokedAt,
      seedFingerprint: row.seedFingerprint,
    });

    const rows = Effect.fn("Connections.rows")(function* (userId: string) {
      yield* Schema.decodeEffect(Schema.NonEmptyString)(userId);
      const found = yield* db.select().from(connections);
      const decoded = yield* Schema.decodeEffect(Schema.Array(ConnectionRow))(found);

      // The object name selects the user; every stored row must agree with the caller.
      if (decoded.some((row) => row.userId !== userId)) return yield* fail("unauthorized");
      return decoded;
    });
    const load = Effect.fn("Connections.load")(function* (userId: string, provider: Provider) {
      return (yield* rows(userId)).find((row) => row.provider === provider) ?? null;
    });
    const status = Effect.fn("Connections.status")(function* (userId: string) {
      return (yield* storage(rows(userId))).map(project);
    });
    const link = Effect.fn("Connections.link")(function* (input: Seed) {
      const seed = yield* Schema.decodeEffect(Seed)(input).pipe(
        Effect.mapError(() => fail("invalid-input")),
      );

      const now = yield* Clock.currentTimeMillis;
      const existing = yield* storage(load(seed.userId, seed.provider));

      // The same explicit link is idempotent; a new one replaces whatever the provider had.
      if (existing && existing.seedFingerprint === seed.fingerprint && existing.revokedAt === null)
        return project(existing);

      const material =
        seed.provider === "openai-chatgpt"
          ? {
              accountId: seed.tokens.accountId,
              access: yield* seal(seed.tokens.access),
              refresh: yield* seal(seed.tokens.refresh),
              idToken: seed.tokens.idToken === undefined ? null : yield* seal(seed.tokens.idToken),
              expiresAt: seed.tokens.expiresAt,
            }
          : {
              accountId: "",
              access: yield* seal(seed.key),
              refresh: yield* seal(""),
              idToken: null,
              expiresAt: 0,
            };

      yield* storage(
        db
          .insert(connections)
          .values({
            provider: seed.provider,
            userId: seed.userId,
            ...material,
            seedFingerprint: seed.fingerprint,
            linkedAt: now,
            rotatedAt: null,
            revokedAt: null,
          })
          .onConflictDoUpdate({
            target: connections.provider,
            set: {
              userId: seed.userId,
              ...material,
              seedFingerprint: seed.fingerprint,
              linkedAt: now,
              rotatedAt: null,
              revokedAt: null,
            },
          }),
      );

      const saved = yield* storage(load(seed.userId, seed.provider));
      if (!saved) return yield* fail("storage");
      return project(saved);
    });
    const revoke = Effect.fn("Connections.revoke")(function* (
      userId: string,
      provider: Provider,
      now: number,
    ) {
      yield* Schema.decodeEffect(Millis)(now).pipe(Effect.mapError(() => fail("invalid-input")));
      const row = yield* storage(load(userId, provider));
      if (!row) return yield* fail("not-linked");
      if (row.revokedAt !== null) return project(row);

      // Revocation empties the material; the row stays as a record of when.
      yield* storage(
        db
          .update(connections)
          .set({ revokedAt: now, access: "", refresh: "", idToken: null })
          .where(eq(connections.provider, provider)),
      );

      return project({ ...row, revokedAt: now });
    });
    /** The row's material, opened; rotated first when a subscription login is about to expire. */
    const fresh = Effect.fn("Connections.fresh")(function* (
      row: ConnectionRow,
      now: number,
      window: number = refreshWindow,
    ) {
      const opened = {
        access: yield* open(row.access),
        refresh: yield* open(row.refresh),
        idToken: row.idToken === null ? null : yield* open(row.idToken),
      };

      // API keys do not rotate; only subscription logins expire.
      if (row.provider !== "openai-chatgpt" || row.expiresAt - now > window)
        return { ...opened, accountId: row.accountId, expiresAt: row.expiresAt };

      const rotated = yield* OAuth.refresh(Redacted.make(opened.refresh)).pipe(
        Effect.provideService(HttpClient.HttpClient, http),
        Effect.mapError((error) =>
          fail(
            error.reason === "reconnect-required"
              ? "reconnect-required"
              : error.reason === "rejected"
                ? "provider-rejected"
                : "provider-unavailable",
          ),
        ),
      );

      if (rotated.accountId !== row.accountId) return yield* fail("conflict");

      const idToken = rotated.idToken ?? opened.idToken;

      // Rotation is persisted before the new access token is ever used.
      yield* storage(
        db
          .update(connections)
          .set({
            access: yield* seal(rotated.access),
            refresh: yield* seal(rotated.refresh),
            idToken: idToken === null ? null : yield* seal(idToken),
            expiresAt: rotated.expiresAt,
            rotatedAt: now,
          })
          .where(eq(connections.provider, row.provider)),
      );

      return {
        access: rotated.access,
        refresh: rotated.refresh,
        idToken,
        accountId: row.accountId,
        expiresAt: rotated.expiresAt,
      };
    });
    const forward = Effect.fn("Connections.forward")(function* (
      userId: string,
      operationId: string,
      input: ForwardRequest,
      gate: <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<A, E>,
    ) {
      yield* Schema.decodeEffect(Schema.NonEmptyString)(operationId).pipe(
        Effect.mapError(() => fail("invalid-input")),
      );

      const request = yield* Schema.decodeEffect(ForwardRequest)(input).pipe(
        Effect.mapError(() => fail("invalid-input")),
      );

      const authorized = yield* gate(
        Effect.gen(function* () {
          const row = yield* storage(load(userId, "openai-api"));
          if (!row) return yield* fail("not-linked");
          if (row.revokedAt !== null) return yield* fail("revoked");

          const [replay] = yield* storage(
            db.select().from(forwards).where(eq(forwards.operationId, operationId)),
          );

          if (replay) {
            const saved = yield* storage(Schema.decodeEffect(ForwardRow)(replay));

            return {
              _tag: "Replay" as const,
              response: ForwardResponse.make({
                status: saved.status,
                contentType: saved.contentType,
                retryAfter: null,
                body: saved.body,
              }),
            };
          }

          const now = yield* Clock.currentTimeMillis;
          const current = yield* fresh(row, now);
          const credentials: Backend.Credentials = { key: Redacted.make(current.access) };

          return { _tag: "Grant" as const, credentials };
        }),
      );

      if (authorized._tag === "Replay") return authorized.response;

      const response = yield* Backend.forward(authorized.credentials, request).pipe(
        Effect.provideService(HttpClient.HttpClient, http),
        Effect.mapError((error) =>
          fail(error.reason === "unsupported-request" ? "invalid-input" : "provider-unavailable"),
        ),
      );

      // Only definitive provider answers are replayable. Pacing responses and transport
      // failures are not recorded, so a retry legitimately sends the request again.
      if (replayable(response.status)) {
        yield* gate(
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;

            yield* storage(
              db.transaction((tx) =>
                Effect.gen(function* () {
                  yield* tx.delete(forwards).where(lt(forwards.createdAt, now - forwardRetention));

                  yield* tx
                    .insert(forwards)
                    .values({
                      operationId,
                      status: response.status,
                      contentType: response.contentType,
                      body: response.body,
                      createdAt: now,
                    })
                    .onConflictDoNothing();
                }),
              ),
            );
          }),
        );
      }

      return response;
    });
    const agentLogin = Effect.fn("Connections.agentLogin")(function* (
      userId: string,
      minimumLifetimeMs: number,
    ) {
      // Agents need a subscription login with its OpenID token; an API key never reaches a box.
      const row = yield* storage(load(userId, "openai-chatgpt"));
      if (!row) return yield* fail("not-linked");
      if (row.revokedAt !== null) return yield* fail("revoked");

      // The box cannot refresh, so the access token must outlive the whole round.
      const current = yield* fresh(row, yield* Clock.currentTimeMillis, minimumLifetimeMs);

      if (current.idToken === null) return yield* fail("reconnect-required");

      return AgentLogin.make({
        access: current.access,
        idToken: current.idToken,
        accountId: current.accountId,
        expiresAt: current.expiresAt,
      });
    });

    const issuer = <A>(
      effect: Effect.Effect<A, { readonly reason: string }, HttpClient.HttpClient>,
    ) =>
      effect.pipe(
        Effect.provideService(HttpClient.HttpClient, http),
        Effect.mapError((error) =>
          fail(error.reason === "rejected" ? "provider-rejected" : "provider-unavailable"),
        ),
      );

    const pendingOf = (row: DeviceLoginRow): DeviceLogin => ({
      state: "pending",
      userCode: row.userCode,
      verificationUrl: Device.verificationUrl,
      expiresAt: row.startedAt + Device.lifetimeMs,
      interval: row.interval,
    });

    const beginDeviceLogin = Effect.fn("Connections.beginDeviceLogin")(function* (userId: string) {
      yield* Schema.decodeEffect(Schema.NonEmptyString)(userId).pipe(
        Effect.mapError(() => fail("invalid-input")),
      );

      const code = yield* issuer(Device.requestCode());
      const now = yield* Clock.currentTimeMillis;

      yield* storage(
        db
          .insert(deviceLogins)
          .values({
            singleton: 1,
            userId,
            deviceAuthId: code.deviceAuthId,
            userCode: code.userCode,
            interval: code.interval,
            startedAt: now,
          })
          .onConflictDoUpdate({
            target: deviceLogins.singleton,
            set: {
              userId,
              deviceAuthId: code.deviceAuthId,
              userCode: code.userCode,
              interval: code.interval,
              startedAt: now,
            },
          }),
      );

      return pendingOf({
        singleton: 1,
        userId,
        deviceAuthId: code.deviceAuthId,
        userCode: code.userCode,
        interval: code.interval,
        startedAt: now,
      });
    });
    const pollDeviceLogin = Effect.fn("Connections.pollDeviceLogin")(function* (userId: string) {
      const [found] = yield* storage(db.select().from(deviceLogins));
      if (!found) return { state: "none" } as const;

      const row = yield* storage(Schema.decodeEffect(DeviceLoginRow)(found));

      if (row.userId !== userId) return yield* fail("unauthorized");

      const now = yield* Clock.currentTimeMillis;
      const forget = storage(db.delete(deviceLogins).where(eq(deviceLogins.singleton, 1)));

      if (now > row.startedAt + Device.lifetimeMs) {
        yield* forget;
        return { state: "expired" } as const;
      }

      const granted = yield* issuer(
        Device.poll({
          deviceAuthId: row.deviceAuthId,
          userCode: row.userCode,
          interval: row.interval,
        }),
      );

      if (Option.isNone(granted)) return pendingOf(row);

      const tokens = yield* issuer(Device.exchange(granted.value));

      const connection = yield* link({
        userId,
        provider: "openai-chatgpt",
        tokens,
        fingerprint: yield* fingerprintOf(`openai-chatgpt:${tokens.accountId}:${tokens.refresh}`),
      });

      yield* forget;

      return { state: "linked", connection } as const;
    });

    return Service.of({
      status,
      link,
      revoke,
      forward,
      agentLogin,
      beginDeviceLogin,
      pollDeviceLogin,
    });
  }),
);
export const layer = layerNoDeps;
export * as Connections from "./connections";

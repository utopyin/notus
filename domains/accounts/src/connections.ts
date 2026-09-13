import { Sqlite } from "@notus/cloudflare/sqlite";
import { Codex } from "@notus/openai/codex";
import { OAuth } from "@notus/openai/oauth";
import { ForwardRequest, ForwardResponse, TokenSet, replayable } from "@notus/openai/types";
import { eq, lt } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as HttpClient from "effect/unstable/http/HttpClient";
import { ConnectionError } from "./errors";
import { ConnectionRow, ForwardRow, connections, forwards } from "./connection";

const Millis = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
/** Explicit administrator link. Possession of a login file is not a link. */
export const Seed = Schema.Struct({
  userId: Schema.NonEmptyString,
  provider: Schema.Literal("openai-chatgpt"),
  tokens: TokenSet,
  fingerprint: Schema.NonEmptyString,
});
export interface Seed extends Schema.Schema.Type<typeof Seed> {}
export const ConnectionStatus = Schema.Struct({
  userId: Schema.NonEmptyString,
  linked: Schema.Boolean,
  provider: Schema.NullOr(Schema.Literal("openai-chatgpt")),
  accountId: Schema.NullOr(Schema.NonEmptyString),
  expiresAt: Schema.NullOr(Millis),
  rotatedAt: Schema.NullOr(Millis),
  revokedAt: Schema.NullOr(Millis),
  /** Hash of the explicit seed that supplied the pair; never the pair itself. */
  seedFingerprint: Schema.NullOr(Schema.NonEmptyString),
});
export interface ConnectionStatus extends Schema.Schema.Type<typeof ConnectionStatus> {}

// Renew shortly before expiry so a forwarded request never races the deadline.
const refreshWindow = 5 * 60_000;
const forwardRetention = 24 * 60 * 60_000;
const fail = (reason: ConnectionError["reason"]) => new ConnectionError({ reason });

/**
 * One saved user-owned model login: link, status, revoke and authorized forwarding.
 * The Durable Object host serializes these calls; refresh therefore never races itself.
 * Provider tokens are read here and nowhere else. forward returns provider responses,
 * never credentials, and replays an identical operation without a second provider call.
 */
export interface Interface {
  readonly status: (userId: string) => Effect.Effect<ConnectionStatus, ConnectionError>;
  readonly link: (seed: Seed) => Effect.Effect<ConnectionStatus, ConnectionError>;
  readonly revoke: (
    userId: string,
    now: number,
  ) => Effect.Effect<ConnectionStatus, ConnectionError>;
  /**
   * gate serializes the local decisions (replay lookup, refresh, record) with every other
   * call on this connection; the provider round trip itself runs outside it.
   */
  readonly forward: (
    userId: string,
    operationId: string,
    request: ForwardRequest,
    gate: <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<A, E>,
  ) => Effect.Effect<ForwardResponse, ConnectionError>;
}
export class Service extends Context.Service<Service, Interface>()("@notus/accounts/Connections") {}

export const layerNoDeps = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = yield* Sqlite.Service;
    const http = yield* HttpClient.HttpClient;
    const storage = <A, E>(effect: Effect.Effect<A, E>) =>
      effect.pipe(
        Effect.mapError((error) =>
          Schema.is(ConnectionError)(error)
            ? error
            : fail(Schema.isSchemaError(error) ? "invalid-input" : "storage"),
        ),
      );
    const project = (row: ConnectionRow): ConnectionStatus => ({
      userId: row.userId,
      linked: row.revokedAt === null,
      provider: row.provider,
      accountId: row.accountId,
      expiresAt: row.expiresAt,
      rotatedAt: row.rotatedAt,
      revokedAt: row.revokedAt,
      seedFingerprint: row.seedFingerprint,
    });
    const load = Effect.fn("Connections.load")(function* (userId: string) {
      yield* Schema.decodeEffect(Schema.NonEmptyString)(userId);
      const [row] = yield* db.select().from(connections).where(eq(connections.singleton, 1));
      if (!row) return null;
      const decoded = yield* Schema.decodeEffect(ConnectionRow)(row);
      // The object name selects the user; the stored row must agree with the caller.
      if (decoded.userId !== userId) return yield* fail("unauthorized");
      return decoded;
    });
    const status = Effect.fn("Connections.status")(function* (userId: string) {
      const row = yield* storage(load(userId));
      if (row) return project(row);
      return ConnectionStatus.make({
        userId,
        linked: false,
        provider: null,
        accountId: null,
        expiresAt: null,
        rotatedAt: null,
        revokedAt: null,
        seedFingerprint: null,
      });
    });
    const link = Effect.fn("Connections.link")(function* (input: Seed) {
      const seed = yield* Schema.decodeEffect(Seed)(input).pipe(
        Effect.mapError(() => fail("invalid-input")),
      );
      const now = yield* Clock.currentTimeMillis;
      return yield* storage(
        db.transaction((tx) =>
          Effect.gen(function* () {
            const [existing] = yield* tx
              .select()
              .from(connections)
              .where(eq(connections.singleton, 1));
            if (existing) {
              const row = yield* Schema.decodeEffect(ConnectionRow)(existing);
              if (row.userId !== seed.userId) return yield* fail("unauthorized");
              // The same explicit link is idempotent. A rotated or revoked connection is
              // never silently overwritten by an older seed; revoke first, then link again.
              if (row.seedFingerprint === seed.fingerprint && row.revokedAt === null)
                return project(row);
              if (row.revokedAt === null) return yield* fail("conflict");
              yield* tx
                .update(connections)
                .set({
                  provider: seed.provider,
                  accountId: seed.tokens.accountId,
                  access: seed.tokens.access,
                  refresh: seed.tokens.refresh,
                  expiresAt: seed.tokens.expiresAt,
                  seedFingerprint: seed.fingerprint,
                  linkedAt: now,
                  rotatedAt: null,
                  revokedAt: null,
                })
                .where(eq(connections.singleton, 1));
            } else {
              yield* tx.insert(connections).values({
                singleton: 1,
                userId: seed.userId,
                provider: seed.provider,
                accountId: seed.tokens.accountId,
                access: seed.tokens.access,
                refresh: seed.tokens.refresh,
                expiresAt: seed.tokens.expiresAt,
                seedFingerprint: seed.fingerprint,
                linkedAt: now,
              });
            }
            const [saved] = yield* tx
              .select()
              .from(connections)
              .where(eq(connections.singleton, 1));
            if (!saved) return yield* fail("storage");
            return project(yield* Schema.decodeEffect(ConnectionRow)(saved));
          }),
        ),
      );
    });
    const revoke = Effect.fn("Connections.revoke")(function* (userId: string, now: number) {
      yield* Schema.decodeEffect(Millis)(now).pipe(Effect.mapError(() => fail("invalid-input")));
      const row = yield* storage(load(userId));
      if (!row) return yield* fail("not-linked");
      if (row.revokedAt !== null) return project(row);
      yield* storage(
        db
          .update(connections)
          .set({ revokedAt: now, access: "", refresh: "" })
          .where(eq(connections.singleton, 1)),
      );
      return project({ ...row, revokedAt: now });
    });
    /** Rotation is persisted before the new access token is ever used. */
    const fresh = Effect.fn("Connections.fresh")(function* (row: ConnectionRow, now: number) {
      if (row.expiresAt - now > refreshWindow) return row;
      const rotated = yield* OAuth.refresh(Redacted.make(row.refresh)).pipe(
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
      yield* storage(
        db
          .update(connections)
          .set({
            access: rotated.access,
            refresh: rotated.refresh,
            expiresAt: rotated.expiresAt,
            rotatedAt: now,
          })
          .where(eq(connections.singleton, 1)),
      );
      return Struct.assign(row, {
        access: rotated.access,
        refresh: rotated.refresh,
        expiresAt: rotated.expiresAt,
        rotatedAt: now,
      });
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
          const row = yield* storage(load(userId));
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
          return {
            _tag: "Grant" as const,
            credentials: {
              access: Redacted.make(current.access),
              accountId: current.accountId,
            },
          };
        }),
      );
      if (authorized._tag === "Replay") return authorized.response;
      const response = yield* Codex.forward(authorized.credentials, request).pipe(
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
    return Service.of({ status, link, revoke, forward });
  }),
);
export const layer = layerNoDeps;
export * as Connections from "./connections";

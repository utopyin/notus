import { Identities } from "@notus/accounts/identities";
import { RepositoryRef } from "@notus/executions/types";
import { D1 } from "@notus/cloudflare/d1";
import type { InstallationRef } from "@notus/platform/ids";
import { Platforms } from "@notus/platforms/registry";
import {
  Admission,
  conversationKeyOf,
  Input,
  key,
  Reservation,
  Source,
} from "@notus/platform/source";
import { Access } from "@notus/workspaces/access";
import { and, desc, eq, sql } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Conflict, IntakeError, Unauthorized } from "./errors";
import { envelopes, messages, routes } from "./schema";
import {
  DrainResult,
  EnvelopeRow,
  MessageRow,
  Receipt,
  RouteRow,
  Snapshot,
  TaskRef,
} from "./types";

export interface Interface {
  /** The workspace that installed a platform, or null when nobody asked for its events. */
  readonly workspaceOf: (ref: InstallationRef) => Effect.Effect<string | null, IntakeError>;
  /**
   * The repositories a task started by this initiator may work in: the workspace's covered GitHub
   * repositories, each reached through its installation, with branches under the initiator's login.
   */
  readonly repositories: (
    workspaceId: string,
    initiatorId: string,
  ) => Effect.Effect<ReadonlyArray<RepositoryRef>, IntakeError>;
  /** Whether the workspace covers the source's scope; ingress asks before spending provider calls. */
  readonly covers: (workspaceId: string, source: Source) => Effect.Effect<boolean, IntakeError>;
  readonly admit: (input: Input) => Effect.Effect<Receipt, IntakeError | Conflict | Unauthorized>;
  /** The route for a conversation, if one exists. */
  readonly routeOf: (
    conversationKey: string,
  ) => Effect.Effect<Schema.Schema.Type<typeof RouteRow> | undefined, IntakeError>;
  /**
   * Route an attached conversation to the task now working on it, taking the route over from an
   * earlier task if one holds it. New messages follow the route; nothing already forwarded moves.
   */
  readonly takeover: (route: Reservation) => Effect.Effect<void, IntakeError>;
  /** Success from forward must mean Task DO admission and its wake are durable. */
  readonly drain: <E>(
    forward: (admission: Admission) => Effect.Effect<void, E>,
  ) => Effect.Effect<DrainResult, IntakeError>;
  readonly snapshot: (workspaceId: string) => Effect.Effect<Snapshot, IntakeError>;
  /** The workspace's tasks by their routes, newest first; each task's state lives in its object. */
  readonly tasks: (
    workspaceId: string,
    limit: number,
  ) => Effect.Effect<ReadonlyArray<TaskRef>, IntakeError>;
  /** Whether one of the task's conversations is routed in this workspace. */
  readonly owns: (workspaceId: string, taskId: string) => Effect.Effect<boolean, IntakeError>;
}
export class Service extends Context.Service<Service, Interface>()(
  "@notus/control/inbox/Service",
) {}

// This limits one Worker pass's SQL/RPC budget, never accepted work or retry count.
const passSize = 25;
const leaseMs = 60_000;
const inputJson = Schema.fromJsonString(Input);
const sourceJson = Schema.fromJsonString(Source);
const storageError = (operation: string) =>
  Effect.mapError((cause: unknown) => new IntakeError({ operation, cause }));
const precedes = (left: string, right: string) =>
  BigInt(left.replace(".", "")) < BigInt(right.replace(".", ""));

export const layerNoDeps = Layer.effect(
  Service,
  Effect.gen(function* () {
    const store = yield* D1.Service;
    const crypto = yield* Crypto.Crypto;
    const identities = yield* Identities.Service;
    const access = yield* Access.Service;
    const platforms = yield* Platforms.Service;
    const findRoute = Effect.fn("Inbox.findRoute")(function* (conversationKey: string) {
      const rows = yield* store.db.select().from(routes).where(eq(routes.key, conversationKey));
      return (yield* Schema.decodeUnknownEffect(Schema.Array(RouteRow))(rows))[0];
    }, storageError("findRoute"));

    const admit = Effect.fn("Inbox.admit")(function* (value: Input) {
      const decoded = yield* Schema.decodeEffect(Input)(value).pipe(storageError("decodeInput"));
      const source = decoded.target.source;
      if (
        decoded.actor.installationId !== source.installationId ||
        decoded.actor.platform !== source.platform
      ) {
        return yield* new IntakeError({
          operation: "decodeInput",
          cause: "Actor installation or platform mismatch",
        });
      }
      // Starting is a platform capability, not something a caller asserts.
      const { descriptor } = yield* platforms
        .forPlatform(source.platform)
        .pipe(storageError("resolvePlatform"));
      if (decoded.startIntent && !descriptor.capabilities.has("input:start"))
        return yield* new IntakeError({
          operation: "decodeInput",
          cause: "Inputs from this platform never start a task",
        });
      // Never trust caller-supplied dedupe keys to partition tenant data.
      const conversationKey = conversationKeyOf(decoded.workspaceId, source);
      const messageKey = key(
        decoded.workspaceId,
        source.platform,
        source.installationId,
        source.scope,
        source.conversation,
        decoded.target.target,
      );
      const input: Input = {
        ...decoded,
        messageKey,
        conversationKey,
        inputId: key("input", messageKey),
      };
      const eventKey = key(
        input.workspaceId,
        source.platform,
        source.installationId,
        input.eventId,
      );
      yield* access.authorizeSource(input.workspaceId, source).pipe(
        Effect.catchTag("Workspaces.Denied", (error) =>
          Effect.fail(new Unauthorized({ workspaceId: input.workspaceId, reason: error.reason })),
        ),
        Effect.mapError((cause) =>
          Schema.is(Unauthorized)(cause)
            ? cause
            : new IntakeError({ operation: "authorizeSource", cause }),
        ),
      );
      let initiatorId: string | null = null;
      if (input.startIntent) {
        const existing = yield* findRoute(conversationKey);
        if (!existing) {
          initiatorId = yield* Effect.gen(function* () {
            const user = yield* identities
              .resolve(input.actor)
              .pipe(storageError("resolveIdentity"));
            if (Option.isNone(user))
              return yield* new Unauthorized({
                workspaceId: input.workspaceId,
                reason: "Starter has no administrator-provisioned identity",
              });
            const grant = yield* access.authorizeStart(input.workspaceId, user.value, source).pipe(
              Effect.catchTag("Workspaces.Denied", (error) =>
                Effect.fail(
                  new Unauthorized({ workspaceId: input.workspaceId, reason: error.reason }),
                ),
              ),
              Effect.mapError((cause) =>
                Schema.is(Unauthorized)(cause)
                  ? cause
                  : new IntakeError({ operation: "authorizeStart", cause }),
              ),
            );
            return grant.initiatorId;
          }).pipe(
            Effect.catchTag("Control.Unauthorized", (error) => {
              // Thread participation needs no start authority. Retain mentions just like
              // ordinary replies while reservation is pending; drain applies startAt.
              // Source authorization above still applies, and storage failures still fail.
              return input.root ? Effect.fail(error) : Effect.succeed(null);
            }),
          );
        }
      }
      const envelopePayload = yield* Schema.encodeEffect(inputJson)(decoded).pipe(
        storageError("encodeEnvelope"),
      );
      const payload = yield* Schema.encodeEffect(inputJson)(input).pipe(
        storageError("encodeInput"),
      );
      // Envelope identity and start intent are deliberately absent from message identity.
      const fingerprint = key(
        input.workspaceId,
        input.actor.platform,
        input.actor.installationId,
        input.actor.externalId,
        source.platform,
        source.installationId,
        source.scope,
        source.conversation,
        input.target.target,
        input.text,
        input.occurredAt,
      );
      const now = yield* Clock.currentTimeMillis;
      yield* store
        .batch([
          // NULL violates NOT NULL and rolls back the whole batch on conflicting replay.
          sql`INSERT INTO inbox_envelopes (key, workspaceId, messageKey, payload, receivedAt)
          VALUES (${eventKey}, ${input.workspaceId}, ${messageKey}, ${envelopePayload}, ${now})
          ON CONFLICT(key) DO UPDATE SET payload = CASE WHEN payload = excluded.payload THEN payload ELSE NULL END`,
          sql`INSERT INTO inbox_messages
          (key, workspaceId, conversationKey, inputId, payload, fingerprint, occurredAt, startIntent, initiatorId, receivedAt, dueAt)
          VALUES (${messageKey}, ${input.workspaceId}, ${conversationKey}, ${input.inputId}, ${payload}, ${fingerprint},
            ${input.occurredAt}, ${input.startIntent ? 1 : 0}, ${initiatorId}, ${now}, ${now})
          ON CONFLICT(key) DO UPDATE SET
            fingerprint = CASE WHEN fingerprint = excluded.fingerprint THEN fingerprint ELSE NULL END,
            startIntent = MAX(startIntent, excluded.startIntent),
            initiatorId = COALESCE(initiatorId, excluded.initiatorId),
            dueAt = CASE WHEN initiatorId IS NULL AND excluded.initiatorId IS NOT NULL AND state = 'pending'
              THEN MIN(dueAt, excluded.dueAt) ELSE dueAt END`,
        ])
        .pipe(
          Effect.catch((cause) =>
            Effect.gen(function* () {
              const oldEnvelope = yield* store
                .query(EnvelopeRow, sql`SELECT * FROM inbox_envelopes WHERE key = ${eventKey}`)
                .pipe(storageError("checkEnvelope"));
              const oldMessage = yield* store
                .query(MessageRow, sql`SELECT * FROM inbox_messages WHERE key = ${messageKey}`)
                .pipe(storageError("checkMessage"));
              if (oldEnvelope[0] && oldEnvelope[0].payload !== envelopePayload)
                return yield* new Conflict({ key: eventKey });
              if (oldMessage[0] && oldMessage[0].fingerprint !== fingerprint)
                return yield* new Conflict({ key: messageKey });
              return yield* new IntakeError({ operation: "commitIntake", cause });
            }),
          ),
        );
      return { eventKey, messageKey, inputId: input.inputId };
    });

    const drain = Effect.fn("Inbox.drain")(function* <E>(
      forward: (admission: Admission) => Effect.Effect<void, E>,
    ) {
      const now = yield* Clock.currentTimeMillis;
      // Unmatched events do not consume the pass budget. The join discovers them as soon as a route exists.
      const due = yield* store.query(
        MessageRow,
        sql`
      SELECT m.* FROM inbox_messages m LEFT JOIN inbox_routes r ON r.key = m.conversationKey
      WHERE ((m.state = 'pending' AND m.dueAt <= ${now}) OR (m.state = 'sending' AND m.recoverAt <= ${now}))
        AND ((r.key IS NULL AND m.initiatorId IS NOT NULL)
          OR (r.key IS NOT NULL AND (r.initialized = 1 OR r.startMessageKey = m.key)))
      ORDER BY CASE WHEN m.state = 'sending' THEN m.recoverAt ELSE m.dueAt END, m.receivedAt, m.key
      LIMIT ${passSize}`,
      );
      const result = {
        scanned: due.length,
        claimed: 0,
        forwarded: 0,
        retried: 0,
        context: 0,
        deferred: 0,
      };
      for (const candidate of due) {
        const token = yield* crypto.randomUUIDv4();
        const claimedAt = yield* Clock.currentTimeMillis;
        const claims = yield* store.query(
          MessageRow,
          sql`
        UPDATE inbox_messages SET state = 'sending', token = ${token}, generation = generation + 1,
          recoverAt = ${claimedAt + leaseMs}, attempts = attempts + 1
        WHERE key = ${candidate.key} AND ((state = 'pending' AND dueAt <= ${claimedAt})
          OR (state = 'sending' AND recoverAt <= ${claimedAt})) RETURNING *`,
        );
        const claim = claims[0];
        if (!claim) continue;
        result.claimed++;
        const fence = sql`key = ${claim.key} AND state = 'sending' AND token = ${token} AND generation = ${claim.generation}`;
        const process = Effect.gen(function* () {
          const original = yield* Schema.decodeEffect(inputJson)(claim.payload);
          const input: Input = { ...original, startIntent: claim.startIntent === 1 };
          let route = yield* findRoute(claim.conversationKey);
          if (!route && claim.initiatorId !== null) {
            const taskId = yield* crypto.randomUUIDv4();
            const source = yield* Schema.encodeEffect(sourceJson)(input.target.source);
            yield* store.batch([
              sql`
            INSERT INTO inbox_routes (key, workspaceId, taskId, initiatorId, startMessageKey, startInputId, startAt, source, createdAt)
            SELECT conversationKey, workspaceId, ${taskId}, initiatorId, key, inputId, occurredAt, ${source}, ${claimedAt}
            FROM inbox_messages WHERE ${fence} AND initiatorId IS NOT NULL
            ON CONFLICT(key) DO NOTHING`,
            ]);
            // Reload all canonical fields even when our insert appears to win.
            route = yield* findRoute(claim.conversationKey);
          }
          if (!route || (route.initialized === 0 && route.startMessageKey !== claim.key)) {
            yield* store.batch([
              sql`UPDATE inbox_messages SET state = 'pending', token = NULL, dueAt = ${claimedAt + 1000}
            WHERE ${fence}`,
            ]);
            result.deferred++;
            return;
          }
          if (precedes(input.occurredAt, route.startAt)) {
            yield* store.batch([
              sql`UPDATE inbox_messages SET state = 'context', token = NULL, lastError = NULL WHERE ${fence}`,
            ]);
            result.context++;
            return;
          }
          const reservation = yield* Schema.decodeEffect(Reservation)({
            taskId: route.taskId,
            workspaceId: route.workspaceId,
            conversationKey: route.key,
            initiatorId: route.initiatorId,
            startInputId: route.startInputId,
            startAt: route.startAt,
            source: yield* Schema.decodeEffect(sourceJson)(route.source),
          });
          yield* forward({ reservation, input });
          // Both writes repeat the fence. A no-op CAS must never initialize a route.
          // Initialize first, before the second statement consumes the successful claim.
          yield* store.batch([
            sql`UPDATE inbox_routes SET initialized = 1 WHERE key = ${route.key} AND startMessageKey = ${claim.key}
            AND EXISTS (SELECT 1 FROM inbox_messages WHERE ${fence})`,
            sql`UPDATE inbox_messages SET state = 'done', token = NULL, lastError = NULL WHERE ${fence}`,
          ]);
          result.forwarded++;
        });
        yield* process.pipe(
          Effect.catch((error) =>
            Effect.gen(function* () {
              const failedAt = yield* Clock.currentTimeMillis;
              // Durable exponential backoff, capped delay but unlimited attempts. No sleeping fibers.
              const delay = Math.min(300_000, 1000 * 2 ** Math.min(claim.attempts - 1, 9));
              yield* store.batch([
                sql`UPDATE inbox_messages SET state = 'pending', token = NULL,
          dueAt = ${failedAt + delay}, lastError = ${String(error).slice(0, 2000)} WHERE ${fence}`,
              ]);
              result.retried++;
            }),
          ),
        );
      }
      return result;
    }, storageError("drain"));

    const workspaceOf = Effect.fn("Inbox.workspaceOf")(function* (ref: InstallationRef) {
      return yield* access.workspaceOf(ref).pipe(storageError("workspaceOf"));
    });
    const repositories = Effect.fn("Inbox.repositories")(function* (
      workspaceId: string,
      initiatorId: string,
    ) {
      const covered = yield* access.repositories(workspaceId).pipe(storageError("repositories"));
      const login = yield* identities.githubLogin(initiatorId).pipe(storageError("repositories"));
      // Without a GitHub login to attribute to, branches live under a neutral namespace.
      const branchPrefix = login?.toLowerCase() ?? "notus";
      return yield* Schema.decodeEffect(Schema.Array(RepositoryRef))(
        covered.flatMap((repository) => {
          const [owner, name] = repository.fullName.split("/");
          return owner && name
            ? [{ owner, name, installationId: repository.installationId, branchPrefix }]
            : [];
        }),
      ).pipe(storageError("repositories"));
    });
    const covers = Effect.fn("Inbox.covers")(function* (workspaceId: string, source: Source) {
      return yield* access.authorizeSource(workspaceId, source).pipe(
        Effect.as(true),
        Effect.catchTag("Workspaces.Denied", () => Effect.succeed(false)),
        storageError("covers"),
      );
    });
    const routeOf = Effect.fn("Inbox.routeOf")(function* (conversationKey: string) {
      return yield* findRoute(conversationKey);
    });
    const takeover = Effect.fn("Inbox.takeover")(function* (value: Reservation) {
      const route = yield* Schema.decodeEffect(Reservation)(value).pipe(
        storageError("decodeRoute"),
      );
      const source = yield* Schema.encodeEffect(sourceJson)(route.source).pipe(
        storageError("encodeRoute"),
      );
      const now = yield* Clock.currentTimeMillis;
      yield* store
        .batch([
          sql`INSERT INTO inbox_routes (key, workspaceId, taskId, initiatorId, startMessageKey, startInputId, startAt, source, createdAt, initialized)
          VALUES (${route.conversationKey}, ${route.workspaceId}, ${route.taskId}, ${route.initiatorId}, ${key("attachment", route.conversationKey)},
            ${route.startInputId}, ${route.startAt}, ${source}, ${now}, 1)
          ON CONFLICT(key) DO UPDATE SET taskId = excluded.taskId, initiatorId = excluded.initiatorId,
            startMessageKey = excluded.startMessageKey, startInputId = excluded.startInputId,
            startAt = excluded.startAt, createdAt = excluded.createdAt, initialized = 1
          WHERE taskId <> excluded.taskId`,
        ])
        .pipe(storageError("takeoverRoute"));
    });

    const snapshot = Effect.fn("Inbox.snapshot")(function* (workspaceId: string) {
      return yield* Schema.decodeUnknownEffect(Snapshot)({
        messages: yield* store.db
          .select()
          .from(messages)
          .where(eq(messages.workspaceId, workspaceId)),
        routes: yield* store.db.select().from(routes).where(eq(routes.workspaceId, workspaceId)),
        envelopes: yield* store.db
          .select()
          .from(envelopes)
          .where(eq(envelopes.workspaceId, workspaceId)),
      });
    }, storageError("snapshot"));
    const tasks = Effect.fn("Inbox.tasks")(function* (workspaceId: string, limit: number) {
      const createdAt = sql<number>`min(${routes.createdAt})`;
      const rows = yield* store.db
        .select({ taskId: routes.taskId, createdAt })
        .from(routes)
        .where(eq(routes.workspaceId, workspaceId))
        .groupBy(routes.taskId)
        .orderBy(desc(createdAt))
        .limit(limit);
      return yield* Schema.decodeEffect(Schema.Array(TaskRef))(rows);
    }, storageError("tasks"));
    const owns = Effect.fn("Inbox.owns")(function* (workspaceId: string, taskId: string) {
      const rows = yield* store.db
        .select({ key: routes.key })
        .from(routes)
        .where(and(eq(routes.workspaceId, workspaceId), eq(routes.taskId, taskId)))
        .limit(1);
      return rows.length > 0;
    }, storageError("owns"));
    return Service.of({
      workspaceOf,
      repositories,
      covers,
      admit,
      routeOf,
      takeover,
      drain,
      snapshot,
      tasks,
      owns,
    });
  }),
);

export const layer = layerNoDeps.pipe(
  Layer.provide([Identities.layerNoDeps, Access.layerNoDeps]),
  Layer.provide(D1.layer),
);
export * as Inbox from "./inbox";

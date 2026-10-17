import { D1 } from "@notus/cloudflare/d1";
import { Sealed } from "@notus/cloudflare/sealed";
import { ComputeCredentials } from "@notus/compute/credentials";
import { ConnectionError } from "@notus/compute/errors";
import { key } from "@notus/platform/source";
import { asc, eq } from "drizzle-orm";
import { createSelectSchema } from "drizzle-orm/effect-schema";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { ComputeConnectionError } from "./errors";
import { computeConnections, memberships } from "./schema";
import { ComputeConnection } from "./types";

/**
 * The provider accounts a workspace connected for its boxes. Members see that one is connected,
 * by whom and when; only admins connect or disconnect one; nothing here returns the credential.
 * The caller validates the credential with the provider's adapter before `connect`.
 */
export interface Interface {
  readonly list: (
    workspaceId: string,
    userId: string,
  ) => Effect.Effect<ReadonlyArray<ComputeConnection>, ComputeConnectionError>;
  /** Replaces any earlier account for the same provider. */
  readonly connect: (
    workspaceId: string,
    actorId: string,
    provider: string,
    label: string,
    credential: Schema.Json,
    now: number,
  ) => Effect.Effect<ReadonlyArray<ComputeConnection>, ComputeConnectionError>;
  readonly disconnect: (
    workspaceId: string,
    actorId: string,
    provider: string,
  ) => Effect.Effect<ReadonlyArray<ComputeConnection>, ComputeConnectionError>;
}
export class Service extends Context.Service<Service, Interface>()(
  "@notus/workspaces/compute/Service",
) {}

const View = Schema.Struct({ key: Schema.String, ...ComputeConnection.fields });
const MemberRow = createSelectSchema(memberships);
const Input = Schema.Struct({
  workspaceId: ComputeConnection.fields.workspaceId,
  provider: ComputeConnection.fields.provider,
  label: ComputeConnection.fields.label,
});
const credentialJson = Schema.fromJsonString(Schema.Json);
type Operation = ComputeConnectionError["operation"];
const fail = (operation: Operation, reason: ComputeConnectionError["reason"]) =>
  new ComputeConnectionError({ operation, reason });

export const layerNoDeps = Layer.effect(
  Service,
  Effect.gen(function* () {
    const store = yield* D1.Service;
    const sealed = yield* Sealed.Service;
    const storage =
      (operation: Operation) =>
      <A, E>(effect: Effect.Effect<A, E>) =>
        effect.pipe(
          Effect.mapError((error) =>
            Schema.is(ComputeConnectionError)(error)
              ? error
              : fail(operation, Schema.isSchemaError(error) ? "invalid-record" : "storage"),
          ),
        );
    const roleOf = (operation: Operation, workspaceId: string, userId: string) =>
      store.db
        .select()
        .from(memberships)
        .where(eq(memberships.key, key(workspaceId, userId)))
        .pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(MemberRow))),
          storage(operation),
          Effect.flatMap((rows) =>
            rows[0] === undefined
              ? Effect.fail(fail(operation, "forbidden"))
              : Effect.succeed(rows[0].role),
          ),
        );
    const requireAdmin = (operation: Operation, workspaceId: string, actorId: string) =>
      roleOf(operation, workspaceId, actorId).pipe(
        Effect.flatMap((role) =>
          role === "admin" ? Effect.void : Effect.fail(fail(operation, "forbidden")),
        ),
      );
    // The credential column is never selected here.
    const read = (operation: Operation, workspaceId: string) =>
      store.db
        .select({
          key: computeConnections.key,
          workspaceId: computeConnections.workspaceId,
          provider: computeConnections.provider,
          label: computeConnections.label,
          connectedBy: computeConnections.connectedBy,
          connectedAt: computeConnections.connectedAt,
        })
        .from(computeConnections)
        .where(eq(computeConnections.workspaceId, workspaceId))
        .orderBy(asc(computeConnections.provider))
        .pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(View))),
          storage(operation),
          Effect.map((rows) =>
            rows.map((row) =>
              ComputeConnection.make({
                workspaceId: row.workspaceId,
                provider: row.provider,
                label: row.label,
                connectedBy: row.connectedBy,
                connectedAt: row.connectedAt,
              }),
            ),
          ),
        );

    const list = Effect.fn("Compute.list")(function* (workspaceId: string, userId: string) {
      yield* roleOf("list", workspaceId, userId);
      return yield* read("list", workspaceId);
    });
    const connect = Effect.fn("Compute.connect")(function* (
      workspaceId: string,
      actorId: string,
      provider: string,
      label: string,
      credential: Schema.Json,
      now: number,
    ) {
      yield* requireAdmin("connect", workspaceId, actorId);
      const input = yield* Schema.decodeEffect(Input)({ workspaceId, provider, label }).pipe(
        Effect.mapError(() => fail("connect", "invalid-input")),
      );
      const encoded = yield* Schema.encodeEffect(credentialJson)(credential).pipe(
        Effect.flatMap(sealed.seal),
        Effect.mapError(() => fail("connect", "invalid-input")),
      );
      const row = {
        label: input.label,
        connectedBy: actorId,
        connectedAt: now,
        credential: encoded,
      };
      yield* store.db
        .insert(computeConnections)
        .values({
          key: key(input.workspaceId, input.provider),
          workspaceId: input.workspaceId,
          provider: input.provider,
          ...row,
        })
        .onConflictDoUpdate({ target: computeConnections.key, set: row })
        .pipe(storage("connect"));
      return yield* read("connect", input.workspaceId);
    });
    const disconnect = Effect.fn("Compute.disconnect")(function* (
      workspaceId: string,
      actorId: string,
      provider: string,
    ) {
      yield* requireAdmin("disconnect", workspaceId, actorId);
      yield* store.db
        .delete(computeConnections)
        .where(eq(computeConnections.key, key(workspaceId, provider)))
        .pipe(storage("disconnect"));
      return yield* read("disconnect", workspaceId);
    });
    return Service.of({ list, connect, disconnect });
  }),
);
export const layer = layerNoDeps.pipe(Layer.provide(D1.layer));

/**
 * The task host's side: the adapter's JSON, opened with the deployment's key. Host-trusted and
 * without authorization, like `Templates.approved`.
 */
export const credentialsNoDeps = Layer.effect(
  ComputeCredentials,
  Effect.gen(function* () {
    const store = yield* D1.Service;
    const sealed = yield* Sealed.Service;
    return ComputeCredentials.of({
      get: Effect.fn("Compute.credential")(function* (workspaceId, provider) {
        const rows = yield* store.db
          .select({ credential: computeConnections.credential })
          .from(computeConnections)
          .where(eq(computeConnections.key, key(workspaceId, provider)))
          .pipe(Effect.mapError(() => new ConnectionError({ provider, reason: "storage" })));
        const stored = rows[0]?.credential;
        if (stored === undefined) return Option.none();
        const opened = yield* sealed.open(stored).pipe(
          Effect.flatMap(Schema.decodeEffect(credentialJson)),
          Effect.mapError(() => new ConnectionError({ provider, reason: "invalid" })),
        );
        return Option.some(opened);
      }),
    });
  }),
);
export const credentials = credentialsNoDeps.pipe(Layer.provide(D1.layer));
export * as Compute from "./compute";

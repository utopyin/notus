import { D1 } from "@notus/cloudflare/d1";
import { snapshot as snapshotJson } from "@notus/contracts/json";
import { eq, sql } from "drizzle-orm";
import { createSelectSchema } from "drizzle-orm/effect-schema";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { EnvironmentError } from "./errors";
import { environments } from "./schema";
import { Environment } from "./types";

/**
 * Host-trusted internal configuration only. Callers own workspace admin authorization;
 * this service is not an HTTP API and must not be exposed directly to agents or users.
 * Providers alone interpret config and resolve secret references.
 */
export interface Interface {
  readonly get: (
    workspaceId: string,
  ) => Effect.Effect<Option.Option<Environment>, EnvironmentError>;
  /** Replaces the default, incrementing its revision even when the values are unchanged. */
  readonly set: (
    workspaceId: string,
    provider: string,
    config: Schema.Json,
  ) => Effect.Effect<Environment, EnvironmentError>;
}
export class Service extends Context.Service<Service, Interface>()(
  "@notus/workspaces/environments/Service",
) {}

const Input = Schema.Struct({
  workspaceId: Environment.fields.workspaceId,
  provider: Environment.fields.provider,
  config: Environment.fields.config,
});
const ConfigText = Schema.fromJsonString(Environment.fields.config);
const Row = createSelectSchema(environments, {
  ...Environment.fields,
  config: ConfigText,
});

// Rows have just been parsed from stored JSON. Freeze them without freezing caller-owned input.
// Keep snapshots independent of subsequent edits; callers can persist one for an attempt later.
const snapshot = (value: Environment): Environment => {
  const pending: Array<Schema.Json> = [value.config];
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === "object" && current !== null) {
      for (const child of Object.values(current)) pending.push(child);
      Object.freeze(current);
    }
  }
  return Object.freeze(value);
};

export const layerNoDeps = Layer.effect(
  Service,
  Effect.gen(function* () {
    const store = yield* D1.Service;
    const get = Effect.fn("Environments.get")(function* (workspaceId: string) {
      const id = yield* Schema.decodeEffect(Environment.fields.workspaceId)(workspaceId).pipe(
        Effect.mapError(() => new EnvironmentError({ operation: "get", reason: "invalid-input" })),
      );
      const rows = yield* store.db
        .select()
        .from(environments)
        .where(eq(environments.workspaceId, id))
        .pipe(
          Effect.mapError(() => new EnvironmentError({ operation: "get", reason: "storage" })),
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Row))),
          Effect.catchTag("SchemaError", () =>
            Effect.fail(new EnvironmentError({ operation: "get", reason: "invalid-record" })),
          ),
        );
      const row = rows[0];
      return row === undefined ? Option.none() : Option.some(snapshot(row));
    });
    const set = Effect.fn("Environments.set")(function* (
      workspaceId: string,
      provider: string,
      config: Schema.Json,
    ) {
      const independent = yield* snapshotJson(config).pipe(
        Effect.mapError(() => new EnvironmentError({ operation: "set", reason: "invalid-input" })),
      );
      const input = yield* Schema.decodeEffect(Input)({
        workspaceId,
        provider,
        config: independent,
      }).pipe(
        Effect.mapError(() => new EnvironmentError({ operation: "set", reason: "invalid-input" })),
      );
      const text = yield* Schema.encodeEffect(ConfigText)(input.config).pipe(
        Effect.mapError(() => new EnvironmentError({ operation: "set", reason: "invalid-input" })),
      );
      // A single D1 statement returns this write's revision, never a later concurrent write's.
      // The table constraint rejects revision overflow without changing the existing row.
      const [row] = yield* store.db
        .insert(environments)
        .values({
          workspaceId: input.workspaceId,
          provider: input.provider,
          config: text,
          revision: 1,
        })
        .onConflictDoUpdate({
          target: environments.workspaceId,
          set: {
            provider: input.provider,
            config: text,
            revision: sql`${environments.revision} + 1`,
          },
        })
        .returning()
        .pipe(
          Effect.mapError(() => new EnvironmentError({ operation: "set", reason: "storage" })),
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Tuple([Row]))),
          Effect.catchTag("SchemaError", () =>
            Effect.fail(new EnvironmentError({ operation: "set", reason: "invalid-record" })),
          ),
        );
      return snapshot(row);
    });
    return Service.of({ get, set });
  }),
);
export const layer = layerNoDeps.pipe(Layer.provide(D1.layer));
export * as Environments from "./environments";

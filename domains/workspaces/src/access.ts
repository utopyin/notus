import { D1 } from "@notus/cloudflare/d1";
import type { InstallationRef } from "@notus/platform/ids";
import { key, Source } from "@notus/platform/source";
import { and, eq } from "drizzle-orm";
import { createSelectSchema } from "drizzle-orm/effect-schema";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { AccessError, Denied } from "./errors";
import { installations, memberships, scopes } from "./schema";
import { StartGrant } from "./types";

export interface Interface {
  /** The workspace that installed a platform, if any; events from anywhere else are nobody's. */
  readonly workspaceOf: (ref: InstallationRef) => Effect.Effect<string | null, AccessError>;
  /** The GitHub repositories the workspace covers, with the installation each is reached through. */
  readonly repositories: (
    workspaceId: string,
  ) => Effect.Effect<
    ReadonlyArray<{ readonly installationId: string; readonly fullName: string }>,
    AccessError
  >;
  readonly authorizeSource: (
    workspaceId: string,
    source: Source,
  ) => Effect.Effect<void, AccessError | Denied>;
  readonly authorizeStart: (
    workspaceId: string,
    userId: string,
    source: Source,
  ) => Effect.Effect<StartGrant, AccessError | Denied>;
}
export class Service extends Context.Service<Service, Interface>()(
  "@notus/workspaces/access/Service",
) {}
const ScopeRow = createSelectSchema(scopes);
const InstallationRow = createSelectSchema(installations);
const MemberRow = createSelectSchema(memberships);

export const layerNoDeps = Layer.effect(
  Service,
  Effect.gen(function* () {
    const store = yield* D1.Service;
    const workspaceOf = Effect.fn("Access.workspaceOf")(
      function* (ref: InstallationRef) {
        const rows = yield* store.db
          .select()
          .from(installations)
          .where(eq(installations.key, key(ref.platform, ref.installationId)))
          .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(InstallationRow))));
        return rows[0]?.workspaceId ?? null;
      },
      Effect.mapError((cause) => new AccessError({ operation: "workspaceOf", cause })),
    );
    const repositories = Effect.fn("Access.repositories")(
      function* (workspaceId: string) {
        const rows = yield* store.db
          .select()
          .from(scopes)
          .where(and(eq(scopes.workspaceId, workspaceId), eq(scopes.platform, "github")))
          .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(ScopeRow))));
        return rows.map((row) => ({ installationId: row.installationId, fullName: row.scope }));
      },
      Effect.mapError((cause) => new AccessError({ operation: "repositories", cause })),
    );
    const authorizeSource = Effect.fn("Access.authorizeSource")(function* (
      workspaceId: string,
      value: Source,
    ) {
      const source = yield* Schema.decodeEffect(Source)(value).pipe(
        Effect.mapError((cause) => new AccessError({ operation: "authorizeSource", cause })),
      );
      const rows = yield* store.db
        .select()
        .from(scopes)
        .where(
          eq(scopes.key, key(workspaceId, source.platform, source.installationId, source.scope)),
        )
        .pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(ScopeRow))),
          Effect.mapError((cause) => new AccessError({ operation: "authorizeSource", cause })),
        );
      if (rows.length === 0)
        return yield* new Denied({ workspaceId, reason: "Scope is not one the workspace covers" });
    });
    const authorizeStart = Effect.fn("Access.authorizeStart")(function* (
      workspaceId: string,
      userId: string,
      source: Source,
    ) {
      yield* authorizeSource(workspaceId, source);
      const rows = yield* store.db
        .select()
        .from(memberships)
        .where(eq(memberships.key, key(workspaceId, userId)))
        .pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(MemberRow))),
          Effect.mapError((cause) => new AccessError({ operation: "authorizeStart", cause })),
        );
      if (rows.length === 0)
        return yield* new Denied({
          workspaceId,
          reason: "Initiator is not a fixture workspace member",
        });
      return { workspaceId, initiatorId: userId };
    });
    return Service.of({ workspaceOf, repositories, authorizeSource, authorizeStart });
  }),
);
export const layer = layerNoDeps.pipe(Layer.provide(D1.layer));
export * as Access from "./access";

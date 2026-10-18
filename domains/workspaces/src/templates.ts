import { SharedDb } from "@notus/db/shared";
import type { TemplateSet } from "@notus/compute/templates";
import { key } from "@notus/platform/source";
import { and, asc, eq, sql } from "drizzle-orm";
import { createSelectSchema } from "drizzle-orm/effect-schema";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { TemplateError } from "./errors";
import { memberships, templates } from "@notus/db/schema/shared";
import { WorkspaceTemplate } from "./types";

/**
 * What a workspace's boxes may start from, as its admins added them. `approved` is host-trusted
 * and carries no authorization: the API and the task host read it for the provider's checks.
 * `list`, `add`, `remove` and `setDefault` are what the dashboard calls, gated on membership. The
 * reference is opaque here; the caller validates it with the provider's adapter before `add`, and
 * nobody but an admin vouches for what the template contains.
 */
export interface Interface {
  readonly approved: (
    workspaceId: string,
    provider: string,
  ) => Effect.Effect<TemplateSet, TemplateError>;
  /** Oldest first, so the select keeps a stable order. */
  readonly list: (
    workspaceId: string,
    userId: string,
  ) => Effect.Effect<ReadonlyArray<WorkspaceTemplate>, TemplateError>;
  /** Adding a reference the workspace already has keeps the first record. */
  readonly add: (
    workspaceId: string,
    actorId: string,
    provider: string,
    ref: string,
    label: string,
    now: number,
  ) => Effect.Effect<ReadonlyArray<WorkspaceTemplate>, TemplateError>;
  readonly remove: (
    workspaceId: string,
    actorId: string,
    provider: string,
    ref: string,
  ) => Effect.Effect<ReadonlyArray<WorkspaceTemplate>, TemplateError>;
  /** Marks one of the provider's templates as the default, or clears it with null. */
  readonly setDefault: (
    workspaceId: string,
    actorId: string,
    provider: string,
    ref: string | null,
  ) => Effect.Effect<ReadonlyArray<WorkspaceTemplate>, TemplateError>;
}
export class Service extends Context.Service<Service, Interface>()(
  "@notus/workspaces/templates/Service",
) {}

const Row = createSelectSchema(templates, WorkspaceTemplate.fields);
const MemberRow = createSelectSchema(memberships);

const Input = Schema.Struct({
  workspaceId: WorkspaceTemplate.fields.workspaceId,
  provider: WorkspaceTemplate.fields.provider,
  ref: WorkspaceTemplate.fields.ref,
  label: WorkspaceTemplate.fields.label,
});

type Operation = TemplateError["operation"];

const fail = (operation: Operation, reason: TemplateError["reason"]) =>
  new TemplateError({ operation, reason });

export const layerNoDeps = Layer.effect(
  Service,
  Effect.gen(function* () {
    const store = yield* SharedDb.Service;

    const storage =
      (operation: Operation) =>
      <A, E>(effect: Effect.Effect<A, E>) =>
        effect.pipe(
          Effect.mapError((error) =>
            Schema.is(TemplateError)(error)
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

    const read = (operation: Operation, workspaceId: string) =>
      store.db
        .select()
        .from(templates)
        .where(eq(templates.workspaceId, workspaceId))
        .orderBy(asc(templates.addedAt), asc(templates.ref))
        .pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Row))),
          storage(operation),
          Effect.map((rows) =>
            rows.map((row) =>
              WorkspaceTemplate.make({
                workspaceId: row.workspaceId,
                provider: row.provider,
                ref: row.ref,
                label: row.label,
                isDefault: row.isDefault,
                addedBy: row.addedBy,
                addedAt: row.addedAt,
              }),
            ),
          ),
        );

    const approved = Effect.fn("Templates.approved")(function* (
      workspaceId: string,
      provider: string,
    ) {
      const rows = (yield* read("approved", workspaceId)).filter(
        (row) => row.provider === provider,
      );

      return {
        refs: rows.map((row) => row.ref),
        default: rows.find((row) => row.isDefault)?.ref ?? null,
      };
    });
    const list = Effect.fn("Templates.list")(function* (workspaceId: string, userId: string) {
      yield* roleOf("list", workspaceId, userId);
      return yield* read("list", workspaceId);
    });
    const add = Effect.fn("Templates.add")(function* (
      workspaceId: string,
      actorId: string,
      provider: string,
      ref: string,
      label: string,
      now: number,
    ) {
      yield* requireAdmin("add", workspaceId, actorId);

      const input = yield* Schema.decodeEffect(Input)({ workspaceId, provider, ref, label }).pipe(
        Effect.mapError(() => fail("add", "invalid-input")),
      );

      yield* store.db
        .insert(templates)
        .values({
          key: key(input.workspaceId, input.provider, input.ref),
          workspaceId: input.workspaceId,
          provider: input.provider,
          ref: input.ref,
          label: input.label,
          isDefault: false,
          addedBy: actorId,
          addedAt: now,
        })
        .onConflictDoNothing()
        .pipe(storage("add"));

      return yield* read("add", input.workspaceId);
    });
    const remove = Effect.fn("Templates.remove")(function* (
      workspaceId: string,
      actorId: string,
      provider: string,
      ref: string,
    ) {
      yield* requireAdmin("remove", workspaceId, actorId);

      yield* store.db
        .delete(templates)
        .where(
          and(
            eq(templates.workspaceId, workspaceId),
            eq(templates.key, key(workspaceId, provider, ref)),
          ),
        )
        .pipe(storage("remove"));

      return yield* read("remove", workspaceId);
    });
    const setDefault = Effect.fn("Templates.setDefault")(function* (
      workspaceId: string,
      actorId: string,
      provider: string,
      ref: string | null,
    ) {
      yield* requireAdmin("default", workspaceId, actorId);

      if (ref !== null) {
        const known = (yield* read("default", workspaceId)).some(
          (row) => row.provider === provider && row.ref === ref,
        );
        if (!known) return yield* fail("default", "not-found");
      }

      // One batch, so the partial unique index never sees two defaults and a reader never none
      // in between.
      yield* store
        .batch([
          sql`UPDATE workspace_templates SET isDefault = 0
            WHERE workspaceId = ${workspaceId} AND provider = ${provider} AND isDefault = 1`,
          ...(ref === null
            ? []
            : [
                sql`UPDATE workspace_templates SET isDefault = 1
                  WHERE workspaceId = ${workspaceId} AND provider = ${provider} AND ref = ${ref}`,
              ]),
        ])
        .pipe(storage("default"));

      return yield* read("default", workspaceId);
    });

    return Service.of({ approved, list, add, remove, setDefault });
  }),
);
export const layer = layerNoDeps;
export * as Templates from "./templates";

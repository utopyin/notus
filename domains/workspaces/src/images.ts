import { D1 } from "@notus/cloudflare/d1";
import { key } from "@notus/platform/source";
import { and, asc, eq } from "drizzle-orm";
import { createSelectSchema } from "drizzle-orm/effect-schema";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { ImageError } from "./errors";
import { images, memberships } from "./schema";
import { WorkspaceImage } from "./types";

/**
 * The devbox images a workspace's admins approved, beside the deployment's own. `approved` is
 * host-trusted and carries no authorization: the API and the task host read it to build the list
 * the provider's policy checks. `list`, `add` and `remove` are what the dashboard calls, gated on
 * membership. The reference is opaque here; the caller validates it with the provider package
 * before `add`, and nobody but an admin vouches for what the image contains.
 */
export interface Interface {
  readonly approved: (
    workspaceId: string,
    provider: string,
  ) => Effect.Effect<ReadonlyArray<string>, ImageError>;
  /** Oldest first, so the select keeps a stable order. */
  readonly list: (
    workspaceId: string,
    userId: string,
  ) => Effect.Effect<ReadonlyArray<WorkspaceImage>, ImageError>;
  /** Adding a reference the workspace already has keeps the first record. */
  readonly add: (
    workspaceId: string,
    actorId: string,
    provider: string,
    ref: string,
    label: string,
    now: number,
  ) => Effect.Effect<ReadonlyArray<WorkspaceImage>, ImageError>;
  readonly remove: (
    workspaceId: string,
    actorId: string,
    provider: string,
    ref: string,
  ) => Effect.Effect<ReadonlyArray<WorkspaceImage>, ImageError>;
}
export class Service extends Context.Service<Service, Interface>()(
  "@notus/workspaces/images/Service",
) {}

const Row = createSelectSchema(images, WorkspaceImage.fields);
const MemberRow = createSelectSchema(memberships);
const Input = Schema.Struct({
  workspaceId: WorkspaceImage.fields.workspaceId,
  provider: WorkspaceImage.fields.provider,
  ref: WorkspaceImage.fields.ref,
  label: WorkspaceImage.fields.label,
});
type Operation = ImageError["operation"];
const fail = (operation: Operation, reason: ImageError["reason"]) =>
  new ImageError({ operation, reason });

export const layerNoDeps = Layer.effect(
  Service,
  Effect.gen(function* () {
    const store = yield* D1.Service;
    const storage =
      (operation: Operation) =>
      <A, E>(effect: Effect.Effect<A, E>) =>
        effect.pipe(
          Effect.mapError((error) =>
            Schema.is(ImageError)(error)
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
        .from(images)
        .where(eq(images.workspaceId, workspaceId))
        .orderBy(asc(images.addedAt), asc(images.ref))
        .pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Row))),
          storage(operation),
          Effect.map((rows) =>
            rows.map((row) =>
              WorkspaceImage.make({
                workspaceId: row.workspaceId,
                provider: row.provider,
                ref: row.ref,
                label: row.label,
                addedBy: row.addedBy,
                addedAt: row.addedAt,
              }),
            ),
          ),
        );

    const approved = Effect.fn("Images.approved")(function* (
      workspaceId: string,
      provider: string,
    ) {
      const rows = yield* read("approved", workspaceId);
      return rows.filter((row) => row.provider === provider).map((row) => row.ref);
    });
    const list = Effect.fn("Images.list")(function* (workspaceId: string, userId: string) {
      yield* roleOf("list", workspaceId, userId);
      return yield* read("list", workspaceId);
    });
    const add = Effect.fn("Images.add")(function* (
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
        .insert(images)
        .values({
          key: key(input.workspaceId, input.provider, input.ref),
          workspaceId: input.workspaceId,
          provider: input.provider,
          ref: input.ref,
          label: input.label,
          addedBy: actorId,
          addedAt: now,
        })
        .onConflictDoNothing()
        .pipe(storage("add"));
      return yield* read("add", input.workspaceId);
    });
    const remove = Effect.fn("Images.remove")(function* (
      workspaceId: string,
      actorId: string,
      provider: string,
      ref: string,
    ) {
      yield* requireAdmin("remove", workspaceId, actorId);
      yield* store.db
        .delete(images)
        .where(
          and(eq(images.workspaceId, workspaceId), eq(images.key, key(workspaceId, provider, ref))),
        )
        .pipe(storage("remove"));
      return yield* read("remove", workspaceId);
    });
    return Service.of({ approved, list, add, remove });
  }),
);
export const layer = layerNoDeps.pipe(Layer.provide(D1.layer));
export * as Images from "./images";

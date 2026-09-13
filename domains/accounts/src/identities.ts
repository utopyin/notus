import { D1 } from "@notus/cloudflare/d1";
import { Actor, key } from "@notus/contracts/source";
import { eq, sql } from "drizzle-orm";
import { createSelectSchema } from "drizzle-orm/effect-schema";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { FixtureConflict, IdentityError } from "./errors";
import { identities } from "./schema";
import { Fixture } from "./types";

export interface Interface {
  readonly resolve: (actor: Actor) => Effect.Effect<Option.Option<string>, IdentityError>;
  readonly seedFixture: (fixture: Fixture) => Effect.Effect<void, IdentityError | FixtureConflict>;
}
export class Service extends Context.Service<Service, Interface>()(
  "@notus/accounts/identities/Service",
) {}
const Row = createSelectSchema(identities);

export const layerNoDeps = Layer.effect(
  Service,
  Effect.gen(function* () {
    const store = yield* D1.Service;
    const resolve = Effect.fn("Identities.resolve")(
      function* (value: Actor) {
        const actor = yield* Schema.decodeEffect(Actor)(value);
        const rows = yield* store.db
          .select()
          .from(identities)
          .where(eq(identities.key, key(actor.kind, actor.installationId, actor.externalId)));
        const decoded = yield* Schema.decodeEffect(Schema.Array(Row))(rows);
        return Option.fromNullishOr(decoded[0]?.userId);
      },
      Effect.mapError((cause) => new IdentityError({ operation: "resolve", cause })),
    );

    const seedFixture = Effect.fn("Identities.seedFixture")(function* (value: Fixture) {
      const fixture = yield* Schema.decodeEffect(Fixture)(value).pipe(
        Effect.mapError((cause) => new IdentityError({ operation: "seedFixture", cause })),
      );
      const { actor, userId } = fixture;
      const identityKey = key(actor.kind, actor.installationId, actor.externalId);
      // Never silently remap an existing identity. Concurrent seeds reload the winner.
      yield* store
        .batch([
          sql`INSERT INTO account_users (id) VALUES (${userId}) ON CONFLICT DO NOTHING`,
          sql`INSERT INTO account_identities (key, kind, installationId, externalId, userId, provenance)
          VALUES (${identityKey}, ${actor.kind}, ${actor.installationId}, ${actor.externalId}, ${userId}, 'admin-fixture')
          ON CONFLICT DO NOTHING`,
        ])
        .pipe(Effect.mapError((cause) => new IdentityError({ operation: "seedFixture", cause })));
      const resolved = yield* resolve(actor);
      if (Option.isNone(resolved) || resolved.value !== userId) {
        return yield* new FixtureConflict({ identityKey });
      }
    });
    return Service.of({ resolve, seedFixture });
  }),
);
export const layer = layerNoDeps.pipe(Layer.provide(D1.layer));
export * as Identities from "./identities";

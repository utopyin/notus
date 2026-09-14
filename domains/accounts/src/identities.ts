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
import { identities, logins } from "./schema";
import { Fixture, Login } from "./types";

export interface Interface {
  readonly resolve: (actor: Actor) => Effect.Effect<Option.Option<string>, IdentityError>;
  readonly seedFixture: (fixture: Fixture) => Effect.Effect<void, IdentityError | FixtureConflict>;
  /**
   * The canonical user a dashboard sign-in acts as, recording the sign-in's verified identities.
   * An identity already held by another user (an administrator fixture) adopts that user for the
   * sign-in; otherwise the sign-in's own ID becomes a canonical user. Never remaps an identity.
   */
  readonly adopt: (login: Login) => Effect.Effect<string, IdentityError>;
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
    const LoginRow = createSelectSchema(logins);
    const adopt = Effect.fn("Identities.adopt")(
      function* (value: Login) {
        const login = yield* Schema.decodeEffect(Login)(value);
        const existing = yield* store.db
          .select()
          .from(logins)
          .where(eq(logins.authUserId, login.authUserId))
          .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(LoginRow))));
        let userId = existing[0]?.userId;
        if (userId === undefined) {
          // Adopt whichever existing user already owns one of the proven identities.
          for (const actor of login.actors) {
            const owner = yield* resolve(actor);
            if (Option.isSome(owner)) {
              userId = owner.value;
              break;
            }
          }
          userId ??= login.authUserId;
          yield* store.batch([
            sql`INSERT INTO account_users (id) VALUES (${userId}) ON CONFLICT DO NOTHING`,
            sql`INSERT INTO account_logins (authUserId, userId, linkedAt)
            VALUES (${login.authUserId}, ${userId}, ${login.now}) ON CONFLICT DO NOTHING`,
          ]);
        }
        const owner = userId;
        for (const actor of login.actors)
          yield* store.batch([
            sql`INSERT INTO account_identities (key, kind, installationId, externalId, userId, provenance)
            VALUES (${key(actor.kind, actor.installationId, actor.externalId)}, ${actor.kind}, ${actor.installationId}, ${actor.externalId}, ${owner}, 'oauth')
            ON CONFLICT DO NOTHING`,
          ]);
        return owner;
      },
      Effect.mapError((cause) => new IdentityError({ operation: "adopt", cause })),
    );
    return Service.of({ resolve, seedFixture, adopt });
  }),
);
export const layer = layerNoDeps.pipe(Layer.provide(D1.layer));
export * as Identities from "./identities";

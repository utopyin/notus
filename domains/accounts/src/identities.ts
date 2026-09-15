import { D1 } from "@notus/cloudflare/d1";
import { Actor, key } from "@notus/platform/source";
import { eq, inArray, sql } from "drizzle-orm";
import { createSelectSchema } from "drizzle-orm/effect-schema";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { FixtureConflict, IdentityError } from "./errors";
import { identities, logins, users } from "./schema";
import { Fixture, Login, Profile } from "./types";

export interface Interface {
  readonly resolve: (actor: Actor) => Effect.Effect<Option.Option<string>, IdentityError>;
  readonly seedFixture: (fixture: Fixture) => Effect.Effect<void, IdentityError | FixtureConflict>;
  /**
   * The canonical user a dashboard sign-in acts as, recording the sign-in's verified identities.
   * An identity already held by another user (an administrator fixture) adopts that user for the
   * sign-in; otherwise the sign-in's own ID becomes a canonical user. Never remaps an identity.
   */
  readonly adopt: (login: Login) => Effect.Effect<string, IdentityError>;
  /** The GitHub login a user is known by, from sign-in or the fixture seed; null when neither gave one. */
  readonly githubLogin: (userId: string) => Effect.Effect<string | null, IdentityError>;
  /** Display profiles of canonical users, for member lists. Users never seen signing in are absent. */
  readonly profiles: (
    userIds: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyMap<string, Profile>, IdentityError>;
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
          .where(eq(identities.key, key(actor.platform, actor.installationId, actor.externalId)));
        const decoded = yield* Schema.decodeEffect(Schema.Array(Row))(rows);
        return Option.fromNullishOr(decoded[0]?.userId);
      },
      Effect.mapError((cause) => new IdentityError({ operation: "resolve", cause })),
    );

    const seedFixture = Effect.fn("Identities.seedFixture")(function* (value: Fixture) {
      const fixture = yield* Schema.decodeEffect(Fixture)(value).pipe(
        Effect.mapError((cause) => new IdentityError({ operation: "seedFixture", cause })),
      );
      const { actor, userId, githubLogin } = fixture;
      const identityKey = key(actor.platform, actor.installationId, actor.externalId);
      // Never silently remap an existing identity. Concurrent seeds reload the winner.
      yield* store
        .batch([
          sql`INSERT INTO account_users (id, githubLogin) VALUES (${userId}, ${githubLogin ?? null})
          ON CONFLICT(id) DO UPDATE SET githubLogin = COALESCE(githubLogin, excluded.githubLogin)`,
          sql`INSERT INTO account_identities (key, kind, installationId, externalId, userId, provenance)
          VALUES (${identityKey}, ${actor.platform}, ${actor.installationId}, ${actor.externalId}, ${userId}, 'admin-fixture')
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
        // The latest sign-in's profile is what member lists show.
        yield* store.batch([
          sql`UPDATE account_users SET name = ${login.profile.name}, email = ${login.profile.email},
          image = ${login.profile.image}, githubLogin = COALESCE(${login.profile.githubLogin}, githubLogin),
          updatedAt = ${login.now} WHERE id = ${owner}`,
        ]);
        for (const actor of login.actors)
          yield* store.batch([
            sql`INSERT INTO account_identities (key, kind, installationId, externalId, userId, provenance)
            VALUES (${key(actor.platform, actor.installationId, actor.externalId)}, ${actor.platform}, ${actor.installationId}, ${actor.externalId}, ${owner}, 'oauth')
            ON CONFLICT DO NOTHING`,
          ]);
        return owner;
      },
      Effect.mapError((cause) => new IdentityError({ operation: "adopt", cause })),
    );
    const UserRow = createSelectSchema(users);
    const githubLogin = Effect.fn("Identities.githubLogin")(
      function* (userId: string) {
        const rows = yield* store.db
          .select({ githubLogin: users.githubLogin })
          .from(users)
          .where(eq(users.id, userId));
        return rows[0]?.githubLogin ?? null;
      },
      Effect.mapError((cause) => new IdentityError({ operation: "githubLogin", cause })),
    );
    const profiles = Effect.fn("Identities.profiles")(
      function* (userIds: ReadonlyArray<string>) {
        const result = new Map<string, Profile>();
        if (userIds.length === 0) return result;
        const rows = yield* store.db
          .select()
          .from(users)
          .where(inArray(users.id, [...userIds]))
          .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(UserRow))));
        for (const row of rows)
          if (row.name !== null && row.email !== null)
            result.set(row.id, {
              name: row.name,
              email: row.email,
              image: row.image,
              githubLogin: row.githubLogin,
            });
        return result;
      },
      Effect.mapError((cause) => new IdentityError({ operation: "profiles", cause })),
    );
    return Service.of({ resolve, seedFixture, adopt, githubLogin, profiles });
  }),
);
export const layer = layerNoDeps.pipe(Layer.provide(D1.layer));
export * as Identities from "./identities";

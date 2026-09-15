import { D1 } from "@notus/cloudflare/d1";
import { OAuth } from "@notus/github/oauth";
import { and, eq, inArray } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/unstable/http/HttpClient";
import { ConnectionError } from "./errors";
import { authAccounts as accounts, logins, users } from "./schema";

const AccountRow = Schema.Struct({
  id: Schema.String,
  accountId: Schema.String,
  accessToken: Schema.NullOr(Schema.String),
  refreshToken: Schema.NullOr(Schema.String),
  accessTokenExpiresAt: Schema.NullOr(Schema.String),
  refreshTokenExpiresAt: Schema.NullOr(Schema.String),
});
const UserRow = Schema.Struct({
  name: Schema.NullOr(Schema.String),
  githubLogin: Schema.NullOr(Schema.String),
});
const LoginRow = Schema.Struct({ authUserId: Schema.String });

/** What a dev box needs to act as the person on GitHub: a token and a commit identity. */
export const GithubLogin = Schema.Struct({
  access: Schema.NonEmptyString,
  expiresAt: Schema.Int,
  login: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  email: Schema.NonEmptyString,
});
export interface GithubLogin extends Schema.Schema.Type<typeof GithubLogin> {}

export interface Interface {
  /**
   * The user's GitHub sign-in as a login for a dev box, refreshed first when it would expire
   * within minimumLifetimeMs. null when the user never signed in with GitHub.
   */
  readonly login: (
    userId: string,
    minimumLifetimeMs: number,
  ) => Effect.Effect<GithubLogin | null, ConnectionError>;
}
export class Service extends Context.Service<Service, Interface>()(
  "@notus/accounts/github-login/Service",
) {}

const fail = (reason: ConnectionError["reason"]) => new ConnectionError({ reason });
const millisOf = (iso: string | null) => {
  if (iso === null) return null;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? null : parsed;
};

export const layerNoDeps = Layer.effect(
  Service,
  Effect.gen(function* () {
    const shared = yield* D1.Service;
    const http = yield* HttpClient.HttpClient;
    const oauth = yield* OAuth.Configuration;
    const storage = <A, E>(effect: Effect.Effect<A, E>) =>
      effect.pipe(Effect.mapError(() => fail("storage")));
    const login = Effect.fn("GithubLogins.login")(function* (
      userId: string,
      minimumLifetimeMs: number,
    ) {
      yield* Schema.decodeEffect(Schema.NonEmptyString)(userId).pipe(
        Effect.mapError(() => fail("invalid-input")),
      );
      const [user] = yield* storage(
        shared.db
          .select({ name: users.name, githubLogin: users.githubLogin })
          .from(users)
          .where(eq(users.id, userId))
          .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(UserRow)))),
      );
      if (!user || user.githubLogin === null) return null;
      // Every dashboard sign-in that acts as this user; usually exactly one.
      const signIns = yield* storage(
        shared.db
          .select({ authUserId: logins.authUserId })
          .from(logins)
          .where(eq(logins.userId, userId))
          .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(LoginRow)))),
      );
      if (signIns.length === 0) return null;
      const [row] = yield* storage(
        shared.db
          .select({
            id: accounts.id,
            accountId: accounts.accountId,
            accessToken: accounts.accessToken,
            refreshToken: accounts.refreshToken,
            accessTokenExpiresAt: accounts.accessTokenExpiresAt,
            refreshTokenExpiresAt: accounts.refreshTokenExpiresAt,
          })
          .from(accounts)
          .where(
            and(
              eq(accounts.providerId, "github"),
              inArray(
                accounts.userId,
                signIns.map((signIn) => signIn.authUserId),
              ),
            ),
          )
          .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(AccountRow)))),
      );
      if (!row || row.accessToken === null) return null;
      const now = yield* Clock.currentTimeMillis;
      const identity = {
        login: user.githubLogin,
        name: user.name ?? user.githubLogin,
        email: `${row.accountId}+${user.githubLogin}@users.noreply.github.com`,
      };
      const expiresAt = millisOf(row.accessTokenExpiresAt);
      // A token GitHub never expires (no expiry recorded) stands as it is.
      if (expiresAt === null || expiresAt - now > minimumLifetimeMs)
        return GithubLogin.make({
          access: row.accessToken,
          expiresAt: expiresAt ?? now + 365 * 24 * 60 * 60_000,
          ...identity,
        });
      const refreshExpiresAt = millisOf(row.refreshTokenExpiresAt);
      if (row.refreshToken === null || (refreshExpiresAt !== null && refreshExpiresAt <= now))
        return yield* fail("reconnect-required");
      const rotated = yield* OAuth.refresh(Redacted.make(row.refreshToken)).pipe(
        Effect.provideService(OAuth.Configuration, oauth),
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
      // Rotation is persisted before the new access token is ever used.
      yield* storage(
        shared.db
          .update(accounts)
          .set({
            accessToken: rotated.access,
            refreshToken: rotated.refresh,
            accessTokenExpiresAt: DateTime.formatIso(DateTime.makeUnsafe(rotated.expiresAt)),
            refreshTokenExpiresAt: DateTime.formatIso(
              DateTime.makeUnsafe(rotated.refreshExpiresAt),
            ),
            updatedAt: DateTime.formatIso(DateTime.makeUnsafe(now)),
          })
          .where(eq(accounts.id, row.id)),
      );
      return GithubLogin.make({
        access: rotated.access,
        expiresAt: rotated.expiresAt,
        ...identity,
      });
    });
    return Service.of({ login });
  }),
);
export const layer = layerNoDeps;
export * as GithubLogins from "./github-login";

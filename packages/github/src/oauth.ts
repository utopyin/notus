import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

/**
 * The App's OAuth client: what signs people in and what refreshes their user tokens. A user
 * token acts as the person within the App's permissions on the repositories where it is installed.
 */
export class Configuration extends Context.Service<
  Configuration,
  {
    readonly clientId: string;
    readonly clientSecret: Redacted.Redacted<string>;
    readonly endpoint?: string;
  }
>()("@notus/github/OAuth.Configuration") {}

export class RefreshError extends Schema.TaggedError<RefreshError>()("Github.RefreshError", {
  /** reconnect-required: the refresh token is gone; only a new sign-in yields another. */
  reason: Schema.Literals(["transport", "rejected", "reconnect-required", "invalid-response"]),
}) {}

const Refreshed = Schema.Struct({
  access_token: Schema.NonEmptyString,
  expires_in: Schema.Int,
  refresh_token: Schema.NonEmptyString,
  refresh_token_expires_in: Schema.Int,
});
const Refused = Schema.Struct({ error: Schema.String });

export interface UserToken {
  readonly access: string;
  readonly refresh: string;
  readonly expiresAt: number;
  readonly refreshExpiresAt: number;
}

/** One refresh of a user token; the old refresh token is spent whether or not the result is stored. */
export const refresh = Effect.fn("Github.OAuth.refresh")(function* (
  refreshToken: Redacted.Redacted<string>,
): Effect.fn.Return<UserToken, RefreshError, Configuration | HttpClient.HttpClient> {
  const config = yield* Configuration;
  const http = yield* HttpClient.HttpClient;

  const request = HttpClientRequest.post(
    `${config.endpoint ?? "https://github.com"}/login/oauth/access_token`,
  ).pipe(
    HttpClientRequest.acceptJson,
    HttpClientRequest.bodyUrlParams({
      client_id: config.clientId,
      client_secret: Redacted.value(config.clientSecret),
      grant_type: "refresh_token",
      refresh_token: Redacted.value(refreshToken),
    }),
  );

  const response = yield* http
    .execute(request)
    .pipe(Effect.mapError(() => new RefreshError({ reason: "transport" })));

  if (response.status !== 200) return yield* new RefreshError({ reason: "rejected" });

  const json = yield* response.json.pipe(
    Effect.mapError(() => new RefreshError({ reason: "invalid-response" })),
  );

  if (Schema.is(Refused)(json))
    return yield* new RefreshError({
      reason: json.error === "bad_refresh_token" ? "reconnect-required" : "rejected",
    });

  const decoded = yield* Schema.decodeUnknownEffect(Refreshed)(json).pipe(
    Effect.mapError(() => new RefreshError({ reason: "invalid-response" })),
  );

  const now = yield* Clock.currentTimeMillis;

  return {
    access: decoded.access_token,
    refresh: decoded.refresh_token,
    expiresAt: now + decoded.expires_in * 1000,
    refreshExpiresAt: now + decoded.refresh_token_expires_in * 1000,
  };
});

export * as OAuth from "./oauth";

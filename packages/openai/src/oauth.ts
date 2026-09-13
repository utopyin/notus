import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import { OAuthError } from "./errors";
import { TokenSet } from "./types";

/** The Codex public client. Notus does not own an independently registered OAuth client. */
export const clientId = "app_EMoamEEZ73f0CkXaXp7hrann";
export const tokenUrl = "https://auth.openai.com/oauth/token";

const TokenResponse = Schema.Struct({
  access_token: Schema.NonEmptyString,
  refresh_token: Schema.NonEmptyString,
  expires_in: Schema.Finite.check(Schema.isGreaterThan(0)),
});
const claim = "https://api.openai.com/auth";
const Claims = Schema.fromJsonString(
  Schema.Struct({ [claim]: Schema.Struct({ chatgpt_account_id: Schema.NonEmptyString }) }),
);
const invalid = (operation: OAuthError["operation"]) =>
  new OAuthError({ operation, reason: "invalid-response" });

/** Reads the account claim without signature verification. It routes requests; it authenticates nobody. */
export const accountIdFromJwt = Effect.fn("OpenAi.OAuth.accountIdFromJwt")(function* (jwt: string) {
  const payload = jwt.split(".")[1];
  if (payload === undefined) return yield* invalid("refresh");
  const bytes = yield* Effect.fromResult(Encoding.decodeBase64Url(payload)).pipe(
    Effect.mapError(() => invalid("refresh")),
  );
  const text = yield* Effect.try({
    try: () => new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    catch: () => invalid("refresh"),
  });
  const claims = yield* Schema.decodeEffect(Claims)(text).pipe(
    Effect.mapError(() => invalid("refresh")),
  );
  return claims[claim].chatgpt_account_id;
});

/** Rotates a refresh token. The caller must persist the result before using it. */
export const refresh = Effect.fn("OpenAi.OAuth.refresh")(
  function* (refreshToken: Redacted.Redacted<string>) {
    const http = yield* HttpClient.HttpClient;
    const request = HttpClientRequest.post(tokenUrl).pipe(
      HttpClientRequest.acceptJson,
      HttpClientRequest.bodyUrlParams({
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: Redacted.value(refreshToken),
      }),
    );
    const response = yield* http
      .execute(request)
      .pipe(Effect.mapError(() => new OAuthError({ operation: "refresh", reason: "transport" })));
    if (response.status === 400 || response.status === 401) {
      // invalid_grant: the login was revoked or rotated elsewhere. Only a new login helps.
      return yield* new OAuthError({
        operation: "refresh",
        reason: "reconnect-required",
        status: response.status,
      });
    }
    if (response.status !== 200)
      return yield* new OAuthError({
        operation: "refresh",
        reason: "rejected",
        status: response.status,
      });
    const body = yield* response.json.pipe(Effect.mapError(() => invalid("refresh")));
    const tokens = yield* Schema.decodeUnknownEffect(TokenResponse)(body).pipe(
      Effect.mapError(() => invalid("refresh")),
    );
    const accountId = yield* accountIdFromJwt(tokens.access_token);
    const now = yield* Clock.currentTimeMillis;
    return TokenSet.make({
      access: tokens.access_token,
      refresh: tokens.refresh_token,
      expiresAt: now + Math.floor(tokens.expires_in * 1000),
      accountId,
    });
  },
  Effect.scoped,
  Effect.timeoutOrElse({
    duration: "15 seconds",
    orElse: () => Effect.fail(new OAuthError({ operation: "refresh", reason: "transport" })),
  }),
);

export * as OAuth from "./oauth";

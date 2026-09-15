import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import { OAuthError } from "./errors";
import { accountIdFromJwt, clientId, tokenUrl } from "./oauth";
import { TokenSet } from "./types";

/**
 * "Sign in with ChatGPT" by device code, as the Codex CLI (rust-v0.154.0, `device_code_auth.rs`)
 * does it: ask the issuer for a user code, send the person to the verification page, poll until
 * the issuer hands back an authorization code with its PKCE verifier, then exchange it at the
 * ordinary token endpoint with the issuer's own device callback as the redirect.
 */
export const issuer = "https://auth.openai.com";
const accounts = `${issuer}/api/accounts`;
export const verificationUrl = `${issuer}/codex/device`;
/** The issuer stops accepting the code after this. */
export const lifetimeMs = 15 * 60_000;

export const DeviceCode = Schema.Struct({
  deviceAuthId: Schema.NonEmptyString,
  userCode: Schema.NonEmptyString,
  /** Seconds between polls, as the issuer asks. */
  interval: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
});
export interface DeviceCode extends Schema.Schema.Type<typeof DeviceCode> {}

const UserCodeResponse = Schema.Struct({
  device_auth_id: Schema.NonEmptyString,
  user_code: Schema.optionalKey(Schema.NonEmptyString),
  usercode: Schema.optionalKey(Schema.NonEmptyString),
  interval: Schema.optionalKey(Schema.Union([Schema.String, Schema.Finite])),
});
const CodeResponse = Schema.Struct({
  authorization_code: Schema.NonEmptyString,
  code_challenge: Schema.String,
  code_verifier: Schema.NonEmptyString,
});
const TokenResponse = Schema.Struct({
  access_token: Schema.NonEmptyString,
  refresh_token: Schema.NonEmptyString,
  expires_in: Schema.optionalKey(Schema.Finite),
  id_token: Schema.optionalKey(Schema.NonEmptyString),
});
const fail = (reason: OAuthError["reason"], status?: number) =>
  new OAuthError({ operation: "device", reason, ...(status === undefined ? {} : { status }) });

/** Step one: a code for the person to type at the verification page. */
export const requestCode = Effect.fn("OpenAi.Device.requestCode")(
  function* () {
    const http = yield* HttpClient.HttpClient;
    const request = yield* HttpClientRequest.post(`${accounts}/deviceauth/usercode`).pipe(
      HttpClientRequest.acceptJson,
      HttpClientRequest.bodyJson({ client_id: clientId }),
      Effect.mapError(() => fail("invalid-response")),
    );
    const response = yield* http.execute(request).pipe(Effect.mapError(() => fail("transport")));
    if (response.status !== 200) return yield* fail("rejected", response.status);
    const body = yield* response.json.pipe(Effect.mapError(() => fail("invalid-response")));
    const decoded = yield* Schema.decodeUnknownEffect(UserCodeResponse)(body).pipe(
      Effect.mapError(() => fail("invalid-response")),
    );
    const userCode = decoded.user_code ?? decoded.usercode;
    const interval = Number(decoded.interval ?? 5);
    if (userCode === undefined || !Number.isInteger(interval) || interval < 1)
      return yield* fail("invalid-response");
    return DeviceCode.make({ deviceAuthId: decoded.device_auth_id, userCode, interval });
  },
  Effect.scoped,
  Effect.timeoutOrElse({ duration: "15 seconds", orElse: () => Effect.fail(fail("transport")) }),
);

/** Step two, repeated: none while the person has not finished; the code and verifier once they have. */
export const poll = Effect.fn("OpenAi.Device.poll")(
  function* (code: DeviceCode) {
    const http = yield* HttpClient.HttpClient;
    const request = yield* HttpClientRequest.post(`${accounts}/deviceauth/token`).pipe(
      HttpClientRequest.acceptJson,
      HttpClientRequest.bodyJson({ device_auth_id: code.deviceAuthId, user_code: code.userCode }),
      Effect.mapError(() => fail("invalid-response")),
    );
    const response = yield* http.execute(request).pipe(Effect.mapError(() => fail("transport")));
    // 403 and 404 are "not yet", per the CLI; anything else besides success is a refusal.
    if (response.status === 403 || response.status === 404)
      return Option.none<{ readonly authorizationCode: string; readonly codeVerifier: string }>();
    if (response.status !== 200) return yield* fail("rejected", response.status);
    const body = yield* response.json.pipe(Effect.mapError(() => fail("invalid-response")));
    const decoded = yield* Schema.decodeUnknownEffect(CodeResponse)(body).pipe(
      Effect.mapError(() => fail("invalid-response")),
    );
    return Option.some({
      authorizationCode: decoded.authorization_code,
      codeVerifier: decoded.code_verifier,
    });
  },
  Effect.scoped,
  Effect.timeoutOrElse({ duration: "15 seconds", orElse: () => Effect.fail(fail("transport")) }),
);

/** Step three: the authorization code becomes the login. */
export const exchange = Effect.fn("OpenAi.Device.exchange")(
  function* (grant: { readonly authorizationCode: string; readonly codeVerifier: string }) {
    const http = yield* HttpClient.HttpClient;
    const request = HttpClientRequest.post(tokenUrl).pipe(
      HttpClientRequest.acceptJson,
      HttpClientRequest.bodyUrlParams({
        grant_type: "authorization_code",
        code: grant.authorizationCode,
        redirect_uri: `${issuer}/deviceauth/callback`,
        client_id: clientId,
        code_verifier: grant.codeVerifier,
      }),
    );
    const response = yield* http.execute(request).pipe(Effect.mapError(() => fail("transport")));
    if (response.status !== 200) return yield* fail("rejected", response.status);
    const body = yield* response.json.pipe(Effect.mapError(() => fail("invalid-response")));
    const tokens = yield* Schema.decodeUnknownEffect(TokenResponse)(body).pipe(
      Effect.mapError(() => fail("invalid-response")),
    );
    const accountId = yield* accountIdFromJwt(tokens.access_token);
    const now = yield* Clock.currentTimeMillis;
    return TokenSet.make({
      access: tokens.access_token,
      refresh: tokens.refresh_token,
      // The issuer's access tokens last about a day; without a figure, assume an hour.
      expiresAt: now + Math.floor((tokens.expires_in ?? 3600) * 1000),
      accountId,
      ...(tokens.id_token === undefined ? {} : { idToken: tokens.id_token }),
    });
  },
  Effect.scoped,
  Effect.timeoutOrElse({ duration: "15 seconds", orElse: () => Effect.fail(fail("transport")) }),
);

export * as Device from "./device";

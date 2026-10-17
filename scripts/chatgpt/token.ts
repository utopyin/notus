/**
 * ChatGPT-subscription OAuth tokens for development inference, stored in
 * `.auth/chatgpt.json` (gitignored). Same constants and shape as pi / opencode /
 * the Codex CLI ("Sign in with ChatGPT").
 */
import { OAuth } from "@notus/openai/oauth";
import { StoredLogin } from "@notus/openai/types";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

/** The provider package owns the client identity; this file only adds the development file. */
export const CLIENT_ID = OAuth.clientId;
export const TOKEN_URL = OAuth.tokenUrl;
export const FILE = ".auth/chatgpt.json";

/** What the worker needs at request time. Serialised into one secret binding. */
export const Credentials = Schema.Struct({
  access: Schema.String,
  accountId: Schema.String,
});
export type Credentials = typeof Credentials.Type;

/** Same shape the Worker's fixture seed decodes. `expires` is epoch milliseconds. */
const Stored = StoredLogin;
export type Stored = typeof Stored.Type;

const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.String,
  expires_in: Schema.Finite,
  id_token: Schema.optionalKey(Schema.String),
});

export class TokenError extends Schema.TaggedError<TokenError>()("ChatGpt.TokenError", {
  message: Schema.String,
}) {}

/** `chatgpt_account_id` from the access token's claims (no signature check; dev only). */
export const accountIdFromJwt = (jwt: string): Effect.Effect<string, TokenError> =>
  OAuth.accountIdFromJwt(jwt).pipe(
    Effect.mapError(() => new TokenError({ message: "cannot read account id" })),
  );

const decodeToken = HttpClientResponse.schemaBodyJson(TokenResponse);

/** Exchange a grant (authorization code or refresh token) for tokens and derive the stored shape. */
export const exchange = (
  params: Record<string, string>,
): Effect.Effect<Stored, TokenError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const response = yield* client
      .execute(
        HttpClientRequest.post(TOKEN_URL).pipe(
          HttpClientRequest.bodyUrlParams({ client_id: CLIENT_ID, ...params }),
        ),
      )
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(decodeToken),
        Effect.mapError((error) => new TokenError({ message: String(error) })),
      );
    const accountId = yield* accountIdFromJwt(response.access_token);
    const now = yield* Clock.currentTimeMillis;
    return {
      access: response.access_token,
      refresh: response.refresh_token,
      expires: now + response.expires_in * 1000,
      accountId,
      ...(response.id_token ? { idToken: response.id_token } : {}),
    };
  });

const StoredJson = Schema.fromJsonString(Stored);

export const save = (stored: Stored) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const text = yield* Schema.encodeEffect(StoredJson)(stored);
    yield* fs.makeDirectory(".auth", { recursive: true });
    yield* fs.writeFileString(FILE, text + "\n", { mode: 0o600 });
  });

export const load = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* fs.exists(FILE))) return Option.none<Stored>();
  const text = yield* fs.readFileString(FILE);
  return Option.some(yield* Schema.decodeEffect(StoredJson)(text));
});

const REFRESH_WINDOW_MS = 5 * 60 * 1000;

/** Load the stored tokens, refreshing (and persisting the rotated pair) when near expiry. */
export const fresh = Effect.gen(function* () {
  const stored = yield* load;
  if (Option.isNone(stored)) return Option.none<Credentials>();
  let current = stored.value;
  const now = yield* Clock.currentTimeMillis;
  if (current.expires - now < REFRESH_WINDOW_MS) {
    current = yield* exchange({ grant_type: "refresh_token", refresh_token: current.refresh });
    yield* save(current);
  }
  return Option.some<Credentials>({ access: current.access, accountId: current.accountId });
});

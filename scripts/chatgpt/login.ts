/**
 * `bun run login:chatgpt` — "Sign in with ChatGPT" (PKCE) and store the tokens
 * in `.auth/chatgpt.json` for development inference. Same flow as pi / opencode.
 */
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunHttpServer from "@effect/platform-bun/BunHttpServer";
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as Console from "effect/Console";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as Token from "./token";

const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const PORT = 1455;
const REDIRECT_URI = `http://localhost:${PORT}/auth/callback`;
const SCOPE = "openid profile email offline_access";

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const randomBytes = (length: number) => crypto.getRandomValues(new Uint8Array(length));

const pkce = Effect.gen(function* () {
  const verifier = base64url(randomBytes(64));
  const digest = yield* Effect.promise(() =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
});

const Callback = Schema.Struct({ code: Schema.String, state: Schema.String });

const program = Effect.gen(function* () {
  const { verifier, challenge } = yield* pkce;
  const state = base64url(randomBytes(16));
  const received = yield* Deferred.make<string, Token.TokenError>();

  const url = new URL(AUTHORIZE_URL);
  for (const [key, value] of Object.entries({
    response_type: "code",
    client_id: Token.CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state,
    originator: "bridle",
  })) {
    url.searchParams.set(key, value);
  }

  const routes = HttpRouter.add(
    "GET",
    "/auth/callback",
    Effect.gen(function* () {
      const params = yield* HttpServerRequest.schemaSearchParams(Callback);
      if (params.state !== state) {
        yield* Deferred.fail(received, new Token.TokenError({ message: "state mismatch" }));
        return HttpServerResponse.text("State mismatch. Close this tab.", { status: 400 });
      }
      yield* Deferred.succeed(received, params.code);
      return HttpServerResponse.text("Signed in. You can close this tab.");
    }),
  );

  yield* Layer.launch(
    HttpRouter.serve(routes, { disableLogger: true, disableListenLog: true }),
  ).pipe(Effect.forkScoped);

  yield* Console.log(`Open this URL to sign in with ChatGPT:\n\n  ${url.href}\n`);
  yield* Effect.promise(() => Bun.spawn(["open", url.href]).exited).pipe(Effect.ignore);

  const code = yield* Deferred.await(received);
  const stored = yield* Token.exchange({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });
  yield* Token.save(stored);
  yield* Console.log(`Saved ${Token.FILE} for account ${stored.accountId}.`);
}).pipe(Effect.scoped);

program.pipe(
  Effect.provide(
    Layer.mergeAll(
      BunHttpServer.layer({ port: PORT, hostname: "127.0.0.1" }),
      BunFileSystem.layer,
      FetchHttpClient.layer,
    ),
  ),
  BunRuntime.runMain,
);

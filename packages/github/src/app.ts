import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import { AppError } from "./errors";
import { InstallationToken, PullRequest, Repository, TaskBranch } from "./types";

/** A dedicated GitHub App: separate from model connections and deployment credentials. */
export class Configuration extends Context.Service<
  Configuration,
  {
    readonly appId: string;
    readonly installationId: string;
    /** PKCS#8 PEM. */
    readonly privateKey: Redacted.Redacted<string>;
    readonly endpoint?: string;
  }
>()("@notus/github/App.Configuration") {}

/**
 * Each operation mints its own token with the least permission it needs. No operation ever
 * holds Contents write and Pull requests write together, so no Notus token can merge.
 */
export interface Interface {
  /** Contents read and Metadata read: clone and fetch. */
  readonly readToken: (repository: Repository) => Effect.Effect<InstallationToken, AppError>;
  /** Contents write and Metadata read: one push to a notus/ branch. */
  readonly pushToken: (repository: Repository) => Effect.Effect<InstallationToken, AppError>;
  /** Pull requests write and Metadata read, executed here: open a pull request for a notus/ branch. */
  readonly createPullRequest: (
    repository: Repository,
    input: { readonly branch: string; readonly title: string; readonly body: string },
  ) => Effect.Effect<PullRequest, AppError>;
}
export class Service extends Context.Service<Service, Interface>()("@notus/github/App") {}

const TokenResponse = Schema.Struct({
  token: Schema.NonEmptyString,
  expires_at: Schema.NonEmptyString,
  permissions: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  repositories: Schema.optionalKey(Schema.Array(Schema.Struct({ name: Schema.String }))),
});
const PullResponse = Schema.Struct({
  number: Schema.Int,
  html_url: Schema.NonEmptyString,
});
const PullInput = Schema.Struct({
  branch: TaskBranch,
  title: Schema.NonEmptyString.check(Schema.isMaxLength(256)),
  body: Schema.String.check(Schema.isMaxLength(60_000)),
});
type Permissions =
  | { readonly contents: "read"; readonly metadata: "read" }
  | { readonly contents: "write"; readonly metadata: "read" }
  | { readonly pull_requests: "write"; readonly metadata: "read" };
const fail = (operation: AppError["operation"], reason: AppError["reason"], status?: number) =>
  new AppError({ operation, reason, ...(status === undefined ? {} : { status }) });
const base64url = (bytes: Uint8Array) => Encoding.encodeBase64Url(bytes);
const Header = Schema.fromJsonString(
  Schema.Struct({ alg: Schema.Literal("RS256"), typ: Schema.Literal("JWT") }),
);
const Claims = Schema.fromJsonString(
  Schema.Struct({ iat: Schema.Int, exp: Schema.Int, iss: Schema.String }),
);
const pem = (text: string) =>
  Effect.gen(function* () {
    const body = text
      .replace(/-----BEGIN PRIVATE KEY-----/, "")
      .replace(/-----END PRIVATE KEY-----/, "")
      .replace(/\s+/g, "");
    if (body.length === 0 || /RSA PRIVATE KEY/.test(text))
      return yield* fail("jwt", "configuration");
    return yield* Effect.fromResult(Encoding.decodeBase64(body)).pipe(
      Effect.mapError(() => fail("jwt", "configuration")),
    );
  });

export const layerNoDeps = Layer.effect(
  Service,
  Effect.gen(function* () {
    const settings = yield* Configuration;
    const http = yield* HttpClient.HttpClient;
    if (!/^\d{1,20}$/.test(settings.appId) || !/^\d{1,20}$/.test(settings.installationId))
      return yield* fail("jwt", "configuration");
    const endpoint = settings.endpoint ?? "https://api.github.com";
    const der = yield* pem(Redacted.value(settings.privateKey));
    const key = yield* Effect.tryPromise({
      try: () =>
        globalThis.crypto.subtle.importKey(
          "pkcs8",
          new Uint8Array(der),
          { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
          false,
          ["sign"],
        ),
      catch: () => fail("jwt", "configuration"),
    });
    const jwt = Effect.fn("GitHub.App.jwt")(function* () {
      const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);
      const encoder = new TextEncoder();
      const header = base64url(
        encoder.encode(
          yield* Schema.encodeEffect(Header)({ alg: "RS256", typ: "JWT" }).pipe(
            Effect.mapError(() => fail("jwt", "configuration")),
          ),
        ),
      );
      const payload = base64url(
        encoder.encode(
          yield* Schema.encodeEffect(Claims)({
            iat: now - 60,
            exp: now + 540,
            iss: settings.appId,
          }).pipe(Effect.mapError(() => fail("jwt", "configuration"))),
        ),
      );
      const signature = yield* Effect.tryPromise({
        try: () =>
          globalThis.crypto.subtle.sign(
            "RSASSA-PKCS1-v1_5",
            key,
            encoder.encode(`${header}.${payload}`),
          ),
        catch: () => fail("jwt", "configuration"),
      });
      return `${header}.${payload}.${base64url(new Uint8Array(signature))}`;
    });
    const headers = HttpClientRequest.setHeaders({
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "notus",
    });
    const token = Effect.fn("GitHub.App.token")(
      function* (input: Repository, permissions: Permissions) {
        const repository = yield* Schema.decodeEffect(Repository)(input).pipe(
          Effect.mapError(() => fail("token", "configuration")),
        );
        const bearer = yield* jwt();
        const request = yield* HttpClientRequest.post(
          `${endpoint}/app/installations/${settings.installationId}/access_tokens`,
        ).pipe(
          headers,
          HttpClientRequest.bearerToken(bearer),
          HttpClientRequest.bodyJson({ repositories: [repository.name], permissions }),
          Effect.mapError(() => fail("token", "configuration")),
        );
        const response = yield* http
          .execute(request)
          .pipe(Effect.mapError(() => fail("token", "transport")));
        if (response.status !== 201) return yield* fail("token", "rejected", response.status);
        const body = yield* response.json.pipe(
          Effect.mapError(() => fail("token", "invalid-response")),
        );
        const decoded = yield* Schema.decodeUnknownEffect(TokenResponse)(body).pipe(
          Effect.mapError(() => fail("token", "invalid-response")),
        );
        const expiresAt = Date.parse(decoded.expires_at);
        if (!Number.isFinite(expiresAt)) return yield* fail("token", "invalid-response");
        return InstallationToken.make({
          token: Redacted.make(decoded.token),
          expiresAt,
          granted: {
            permissions: decoded.permissions ?? {},
            repositories: (decoded.repositories ?? []).map((entry) => entry.name),
          },
        });
      },
      Effect.scoped,
      Effect.timeoutOrElse({
        duration: "15 seconds",
        orElse: () => Effect.fail(fail("token", "transport")),
      }),
    );
    const createPullRequest = Effect.fn("GitHub.App.createPullRequest")(
      function* (
        repositoryInput: Repository,
        input: { readonly branch: string; readonly title: string; readonly body: string },
      ) {
        const repository = yield* Schema.decodeEffect(Repository)(repositoryInput).pipe(
          Effect.mapError(() => fail("pull-request", "configuration")),
        );
        const pull = yield* Schema.decodeEffect(PullInput)(input).pipe(
          Effect.mapError(() => fail("pull-request", "configuration")),
        );
        if (pull.branch === repository.defaultBranch)
          return yield* fail("pull-request", "configuration");
        const grant = yield* token(repository, { pull_requests: "write", metadata: "read" });
        const request = yield* HttpClientRequest.post(
          `${endpoint}/repos/${repository.owner}/${repository.name}/pulls`,
        ).pipe(
          headers,
          HttpClientRequest.bearerToken(grant.token),
          HttpClientRequest.bodyJson({
            title: pull.title,
            body: pull.body,
            head: pull.branch,
            base: repository.defaultBranch,
          }),
          Effect.mapError(() => fail("pull-request", "configuration")),
        );
        const response = yield* http
          .execute(request)
          .pipe(Effect.mapError(() => fail("pull-request", "transport")));
        if (response.status !== 201)
          return yield* fail("pull-request", "rejected", response.status);
        const body = yield* response.json.pipe(
          Effect.mapError(() => fail("pull-request", "invalid-response")),
        );
        const decoded = yield* Schema.decodeUnknownEffect(PullResponse)(body).pipe(
          Effect.mapError(() => fail("pull-request", "invalid-response")),
        );
        return yield* Schema.decodeEffect(PullRequest)({
          number: decoded.number,
          url: decoded.html_url,
          branch: pull.branch,
        }).pipe(Effect.mapError(() => fail("pull-request", "invalid-response")));
      },
      Effect.scoped,
      Effect.timeoutOrElse({
        duration: "20 seconds",
        orElse: () => Effect.fail(fail("pull-request", "transport")),
      }),
    );
    return Service.of({
      readToken: (repository) => token(repository, { contents: "read", metadata: "read" }),
      pushToken: (repository) => token(repository, { contents: "write", metadata: "read" }),
      createPullRequest,
    });
  }),
);
export const layer = layerNoDeps;
export * as App from "./app";

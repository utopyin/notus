import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Base64 from "effect/encoding/Base64";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { AppError } from "./errors";
import { InstallationToken, PullRequest, Repository, RepositoryName, TaskBranch } from "./types";

/** A dedicated GitHub App: separate from model connections and deployment credentials. */
export class Configuration extends Context.Service<
  Configuration,
  {
    readonly appId: string;
    /** PKCS#8 PEM. */
    readonly privateKey: Redacted.Redacted<string>;
    readonly endpoint?: string;
  }
>()("@notus/github/App.Configuration") {}

/** Where the App is installed, as GitHub describes it. */
export interface Installation {
  readonly id: string;
  /** The user or organization: what an administrator recognizes the installation by. */
  readonly account: string;
}

/**
 * Each operation mints its own token with the least permission it needs. No operation ever
 * holds Contents write and Pull requests write together, so no Notus token can merge.
 */
/** A repository the installation reaches, as an administrator picks it. */
export interface InstallationRepository {
  readonly fullName: string;
  readonly private: boolean;
}
export interface Bound {
  /** Metadata read over the whole installation: the repositories it reaches, archived ones left out. */
  readonly repositories: Effect.Effect<ReadonlyArray<InstallationRepository>, AppError>;
  /** Contents read and Metadata read: clone and fetch. */
  readonly readToken: (repository: RepositoryName) => Effect.Effect<InstallationToken, AppError>;
  /** Contents write and Metadata read: one push to a notus/ branch. */
  readonly pushToken: (repository: RepositoryName) => Effect.Effect<InstallationToken, AppError>;
  /** Pull requests write and Metadata read, executed here: open a pull request for a notus/ branch. */
  readonly createPullRequest: (
    repository: Repository,
    input: { readonly branch: string; readonly title: string; readonly body: string },
  ) => Effect.Effect<PullRequest, AppError>;
  /** Metadata read: the commenter's role on the repository, "none" when not a collaborator. */
  readonly collaboratorRole: (
    repository: RepositoryName,
    login: string,
  ) => Effect.Effect<Role, AppError>;
  /** Pull requests write with Contents read: a top-level comment on the pull request. */
  readonly comment: (
    repository: RepositoryName,
    input: { readonly pullNumber: number; readonly body: string },
  ) => Effect.Effect<{ readonly id: string; readonly url: string }, AppError>;
  /** Pull requests write with Contents read: a threaded reply to one review comment. */
  readonly replyToReviewComment: (
    repository: RepositoryName,
    input: { readonly pullNumber: number; readonly commentId: string; readonly body: string },
  ) => Effect.Effect<{ readonly id: string; readonly url: string }, AppError>;
  /** Pull requests write with Contents read: an eyes reaction as receipt. */
  readonly react: (
    repository: RepositoryName,
    input: { readonly kind: "issue-comment" | "review-comment"; readonly commentId: string },
  ) => Effect.Effect<void, AppError>;
}
/** A repository of an installation as one person reaches it through their user token. */
export interface UserRepository {
  readonly fullName: string;
  /** Push or admin: what Notus's own tokens would do there on the person's behalf. */
  readonly push: boolean;
}
/** The App itself; every repository operation happens through one of its installations. */
export interface Interface {
  readonly forInstallation: (installationId: string) => Effect.Effect<Bound, AppError>;
  /** App JWT only: which account an installation belongs to. */
  readonly installation: (installationId: string) => Effect.Effect<Installation, AppError>;
  /**
   * With the person's own user token: the installation's repositories they reach, or null when
   * GitHub gives them no access to the installation at all. Proves who may claim an installation.
   */
  readonly userRepositories: (
    installationId: string,
    userToken: Redacted.Redacted<string>,
  ) => Effect.Effect<ReadonlyArray<UserRepository> | null, AppError>;
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
  // GitHub reads both refs when opening a pull request, so Contents read is required.
  | { readonly pull_requests: "write"; readonly contents: "read"; readonly metadata: "read" }
  | { readonly metadata: "read" };
const PermissionResponse = Schema.Struct({ role_name: Schema.optionalKey(Schema.String) });
const CommentResponse = Schema.Struct({ id: Schema.Int, html_url: Schema.NonEmptyString });
export const Role = Schema.Literals(["admin", "maintain", "write", "triage", "read", "none"]);
export type Role = typeof Role.Type;
const ValidationBody = Schema.Struct({
  message: Schema.optionalKey(Schema.String),
  errors: Schema.optionalKey(
    Schema.Array(Schema.Struct({ message: Schema.optionalKey(Schema.String) })),
  ),
});
const fail = (operation: AppError["operation"], reason: AppError["reason"], status?: number) =>
  new AppError({ operation, reason, ...(status === undefined ? {} : { status }) });
const base64url = (bytes: Uint8Array) => Base64Url.encode(bytes);
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
    return yield* Effect.fromResult(Base64.decode(body)).pipe(
      Effect.mapError(() => fail("jwt", "configuration")),
    );
  });

export const layerNoDeps = Layer.effect(
  Service,
  Effect.gen(function* () {
    const settings = yield* Configuration;
    const http = yield* HttpClient.HttpClient;
    if (!/^\d{1,20}$/.test(settings.appId)) return yield* fail("jwt", "configuration");
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
    const InstallationResponse = Schema.Struct({
      id: Schema.Int,
      account: Schema.Struct({ login: Schema.NonEmptyString }),
    });
    const installation = Effect.fn("GitHub.App.installation")(
      function* (installationId: string) {
        if (!/^\d{1,20}$/.test(installationId)) return yield* fail("token", "configuration");
        const bearer = yield* jwt();
        const request = HttpClientRequest.get(
          `${endpoint}/app/installations/${installationId}`,
        ).pipe(headers, HttpClientRequest.bearerToken(bearer));
        const response = yield* http
          .execute(request)
          .pipe(Effect.mapError(() => fail("token", "transport")));
        if (response.status !== 200) return yield* fail("token", "rejected", response.status);
        const body = yield* response.json.pipe(
          Effect.mapError(() => fail("token", "invalid-response")),
        );
        const decoded = yield* Schema.decodeUnknownEffect(InstallationResponse)(body).pipe(
          Effect.mapError(() => fail("token", "invalid-response")),
        );
        return { id: String(decoded.id), account: decoded.account.login };
      },
      Effect.scoped,
      Effect.timeoutOrElse({
        duration: "15 seconds",
        orElse: () => Effect.fail(fail("token", "transport")),
      }),
    );
    const UserRepositoriesResponse = Schema.Struct({
      repositories: Schema.Array(
        Schema.Struct({
          full_name: Schema.NonEmptyString,
          permissions: Schema.optionalKey(
            Schema.Struct({
              admin: Schema.optionalKey(Schema.Boolean),
              push: Schema.optionalKey(Schema.Boolean),
            }),
          ),
        }),
      ),
    });
    const userRepositories = Effect.fn("GitHub.App.userRepositories")(
      function* (installationId: string, userToken: Redacted.Redacted<string>) {
        if (!/^\d{1,20}$/.test(installationId)) return yield* fail("token", "configuration");
        const found: Array<UserRepository> = [];
        // The same ten-page ceiling as the installation's own listing.
        for (let page = 1; page <= 10; page++) {
          const request = HttpClientRequest.get(
            `${endpoint}/user/installations/${installationId}/repositories?per_page=100&page=${page}`,
          ).pipe(headers, HttpClientRequest.bearerToken(Redacted.value(userToken)));
          const response = yield* http
            .execute(request)
            .pipe(Effect.mapError(() => fail("token", "transport")));
          // GitHub answers 403/404 when the person has no access to the installation.
          if (response.status === 403 || response.status === 404) return null;
          if (response.status !== 200) return yield* fail("token", "rejected", response.status);
          const body = yield* response.json.pipe(
            Effect.mapError(() => fail("token", "invalid-response")),
          );
          const decoded = yield* Schema.decodeUnknownEffect(UserRepositoriesResponse)(body).pipe(
            Effect.mapError(() => fail("token", "invalid-response")),
          );
          for (const entry of decoded.repositories)
            found.push({
              fullName: entry.full_name,
              push: entry.permissions?.admin === true || entry.permissions?.push === true,
            });
          if (decoded.repositories.length < 100) break;
        }
        return found;
      },
      Effect.scoped,
      Effect.timeoutOrElse({
        duration: "20 seconds",
        orElse: () => Effect.fail(fail("token", "transport")),
      }),
    );
    const bind = (installationId: string): Bound => {
      /** Mints a token; scoped to one repository unless the operation needs the whole installation. */
      const mint = Effect.fn("GitHub.App.token")(
        function* (permissions: Permissions, input: RepositoryName | null) {
          // The merge endpoint needs both; no Notus token may ever carry both.
          if ("pull_requests" in permissions && permissions.contents !== "read")
            return yield* fail("token", "configuration");
          const repository =
            input === null
              ? null
              : yield* Schema.decodeEffect(RepositoryName)(input).pipe(
                  Effect.mapError(() => fail("token", "configuration")),
                );
          const bearer = yield* jwt();
          const request = yield* HttpClientRequest.post(
            `${endpoint}/app/installations/${installationId}/access_tokens`,
          ).pipe(
            headers,
            HttpClientRequest.bearerToken(bearer),
            HttpClientRequest.bodyJson({
              ...(repository === null ? {} : { repositories: [repository.name] }),
              permissions,
            }),
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
      const token = (input: RepositoryName, permissions: Permissions) => mint(permissions, input);
      const RepositoriesResponse = Schema.Struct({
        repositories: Schema.Array(
          Schema.Struct({
            full_name: Schema.NonEmptyString,
            private: Schema.Boolean,
            archived: Schema.optionalKey(Schema.Boolean),
          }),
        ),
      });
      const repositories = Effect.gen(function* () {
        const grant = yield* mint({ metadata: "read" }, null);
        const found: Array<InstallationRepository> = [];
        // GitHub pages at 100; an installation larger than ten pages is not one Notus serves yet.
        for (let page = 1; page <= 10; page++) {
          const request = HttpClientRequest.get(
            `${endpoint}/installation/repositories?per_page=100&page=${page}`,
          ).pipe(headers, HttpClientRequest.bearerToken(Redacted.value(grant.token)));
          const response = yield* http
            .execute(request)
            .pipe(Effect.mapError(() => fail("token", "transport")));
          if (response.status !== 200) return yield* fail("token", "rejected", response.status);
          const body = yield* response.json.pipe(
            Effect.mapError(() => fail("token", "invalid-response")),
          );
          const decoded = yield* Schema.decodeUnknownEffect(RepositoriesResponse)(body).pipe(
            Effect.mapError(() => fail("token", "invalid-response")),
          );
          for (const entry of decoded.repositories)
            if (entry.archived !== true)
              found.push({ fullName: entry.full_name, private: entry.private });
          if (decoded.repositories.length < 100) break;
        }
        return found.sort((a, b) => a.fullName.localeCompare(b.fullName));
      }).pipe(
        Effect.scoped,
        Effect.timeoutOrElse({
          duration: "20 seconds",
          orElse: () => Effect.fail(fail("token", "transport")),
        }),
        Effect.withSpan("GitHub.App.repositories"),
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
          const grant = yield* token(repository, {
            pull_requests: "write",
            contents: "read",
            metadata: "read",
          });
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
          if (response.status !== 201) {
            const validation = yield* response.json.pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(ValidationBody)),
              Effect.option,
            );
            const detail =
              validation._tag === "Some"
                ? [
                    validation.value.message,
                    ...(validation.value.errors ?? []).map((e) => e.message),
                  ]
                    .filter((part): part is string => typeof part === "string")
                    .join(": ")
                    .slice(0, 300)
                : "";
            return yield* new AppError({
              operation: "pull-request",
              reason: "rejected",
              status: response.status,
              ...(detail ? { detail } : {}),
            });
          }
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
      const discussion = { pull_requests: "write", contents: "read", metadata: "read" } as const;
      const send = Effect.fn("GitHub.App.send")(
        function* (
          operation: "permission" | "comment" | "reaction",
          repositoryInput: RepositoryName,
          permissions: Permissions,
          method: "GET" | "POST",
          path: string,
          body: unknown,
        ) {
          const repository = yield* Schema.decodeEffect(RepositoryName)(repositoryInput).pipe(
            Effect.mapError(() => fail(operation, "configuration")),
          );
          const grant = yield* token(repository, permissions);
          const url = `${endpoint}/repos/${repository.owner}/${repository.name}${path}`;
          const base = (
            method === "GET" ? HttpClientRequest.get(url) : HttpClientRequest.post(url)
          ).pipe(headers, HttpClientRequest.bearerToken(grant.token));
          const request =
            body === undefined
              ? base
              : yield* HttpClientRequest.bodyJson(base, body).pipe(
                  Effect.mapError(() => fail(operation, "configuration")),
                );
          const response = yield* http
            .execute(request)
            .pipe(Effect.mapError(() => fail(operation, "transport")));
          const json = yield* response.json.pipe(Effect.orElseSucceed(() => null));
          return { status: response.status, json };
        },
        Effect.scoped,
        Effect.timeoutOrElse({
          duration: "20 seconds",
          orElse: () => Effect.fail(fail("comment", "transport")),
        }),
      );
      const collaboratorRole = Effect.fn("GitHub.App.collaboratorRole")(function* (
        repository: RepositoryName,
        login: string,
      ) {
        if (!/^[A-Za-z0-9-]{1,39}(\[bot\])?$/.test(login)) return "none" as const;
        const result = yield* send(
          "permission",
          repository,
          { metadata: "read" },
          "GET",
          `/collaborators/${login}/permission`,
          undefined,
        );
        if (result.status === 404) return "none" as const;
        if (result.status !== 200) return yield* fail("permission", "rejected", result.status);
        const decoded = yield* Schema.decodeUnknownEffect(PermissionResponse)(result.json).pipe(
          Effect.mapError(() => fail("permission", "invalid-response")),
        );
        return Schema.is(Role)(decoded.role_name) ? decoded.role_name : ("none" as const);
      });
      const posted = (operation: "comment", result: { status: number; json: unknown }) =>
        result.status === 201
          ? Schema.decodeUnknownEffect(CommentResponse)(result.json).pipe(
              Effect.map((comment) => ({ id: String(comment.id), url: comment.html_url })),
              Effect.mapError(() => fail(operation, "invalid-response")),
            )
          : Effect.fail(fail(operation, "rejected", result.status));
      const comment = Effect.fn("GitHub.App.comment")(function* (
        repository: RepositoryName,
        input: { readonly pullNumber: number; readonly body: string },
      ) {
        if (
          !Number.isSafeInteger(input.pullNumber) ||
          input.pullNumber <= 0 ||
          input.body.length > 60_000
        )
          return yield* fail("comment", "configuration");
        return yield* posted(
          "comment",
          yield* send(
            "comment",
            repository,
            discussion,
            "POST",
            `/issues/${input.pullNumber}/comments`,
            {
              body: input.body,
            },
          ),
        );
      });
      const replyToReviewComment = Effect.fn("GitHub.App.replyToReviewComment")(function* (
        repository: RepositoryName,
        input: { readonly pullNumber: number; readonly commentId: string; readonly body: string },
      ) {
        if (
          !Number.isSafeInteger(input.pullNumber) ||
          input.pullNumber <= 0 ||
          !/^\d{1,20}$/.test(input.commentId) ||
          input.body.length > 60_000
        )
          return yield* fail("comment", "configuration");
        return yield* posted(
          "comment",
          yield* send(
            "comment",
            repository,
            discussion,
            "POST",
            `/pulls/${input.pullNumber}/comments/${input.commentId}/replies`,
            { body: input.body },
          ),
        );
      });
      const react = Effect.fn("GitHub.App.react")(function* (
        repository: RepositoryName,
        input: { readonly kind: "issue-comment" | "review-comment"; readonly commentId: string },
      ) {
        if (!/^\d{1,20}$/.test(input.commentId)) return yield* fail("reaction", "configuration");
        const path =
          input.kind === "issue-comment"
            ? `/issues/comments/${input.commentId}/reactions`
            : `/pulls/comments/${input.commentId}/reactions`;
        const result = yield* send("reaction", repository, discussion, "POST", path, {
          content: "eyes",
        });
        // 200 means the same reaction already existed, which is the idempotent outcome.
        if (result.status !== 201 && result.status !== 200)
          return yield* fail("reaction", "rejected", result.status);
      });
      return {
        repositories,
        collaboratorRole,
        comment,
        replyToReviewComment,
        react,
        readToken: (repository) => token(repository, { contents: "read", metadata: "read" }),
        pushToken: (repository) => token(repository, { contents: "write", metadata: "read" }),
        createPullRequest,
      } satisfies Bound;
    };
    return Service.of({
      forInstallation: (installationId) =>
        /^\d{1,20}$/.test(installationId)
          ? Effect.succeed(bind(installationId))
          : Effect.fail(fail("token", "configuration")),
      installation,
      userRepositories,
    });
  }),
);
export const layer = layerNoDeps;
/** For deployments without an App: every operation fails closed as unconfigured. */
export const disabled = Layer.succeed(
  Service,
  Service.of({
    forInstallation: () => Effect.fail(fail("token", "configuration")),
    installation: () => Effect.fail(fail("token", "configuration")),
    userRepositories: () => Effect.fail(fail("token", "configuration")),
  }),
);
export * as App from "./app";

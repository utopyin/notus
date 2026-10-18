import type { RuntimeContext } from "alchemy/RuntimeContext";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as HttpBody from "effect/http/HttpBody";
import type * as HttpServerError from "effect/http/HttpServerError";
import type * as HttpServerRequest from "effect/http/HttpServerRequest";
import type * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";

export class SessionError extends Schema.TaggedError<SessionError>()("Sessions.SessionError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

/** A dashboard sign-in, as the API reads it from the forwarded cookie. */
export interface SignIn {
  readonly sessionId: string;
  readonly user: {
    readonly id: string;
    readonly name: string;
    readonly email: string;
    readonly image: string | null;
    readonly slackTeamId: string | null;
    readonly githubLogin: string | null;
  };
  /** Linked provider accounts by provider and subject, never their tokens. */
  readonly accounts: ReadonlyArray<{
    readonly id: string;
    readonly providerId: string;
    readonly accountId: string;
    readonly createdAt: Date;
  }>;
}

export interface Session {
  readonly id: string;
  readonly createdAt: Date;
  readonly userAgent: string | null;
}

/**
 * The dashboard's sign-in. Sessions are validated by this Worker, never trusted from the
 * dashboard; the app implements it over its auth provider.
 */
export interface Interface {
  /** Null for an anonymous request. */
  readonly signIn: (cookie: string) => Effect.Effect<SignIn | null, SessionError, RuntimeContext>;
  readonly list: (
    cookie: string,
  ) => Effect.Effect<ReadonlyArray<Session>, SessionError, RuntimeContext>;
  /** Revokes one of the caller's own sessions by ID; false when they hold none by that ID. */
  readonly revoke: (
    cookie: string,
    sessionId: string,
  ) => Effect.Effect<boolean, SessionError, RuntimeContext>;
  /** The provider's own routes, mounted under `/auth`. */
  readonly fetch: Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    HttpServerError.HttpServerError | HttpBody.HttpBodyError,
    HttpServerRequest.HttpServerRequest | RuntimeContext | Scope.Scope
  >;
}

/**
 * Methods run inside an object or Worker handler, which supplies the runtime context.
 *
 * @effect-expect-leaking RuntimeContext
 */
export class Service extends Context.Service<Service, Interface>()(
  "@notus/control/hosts/Sessions",
) {}

export * as Sessions from "./sessions";

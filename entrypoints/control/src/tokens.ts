import type { RepositoryRef } from "@notus/executions/types";
import { App as GithubApp } from "@notus/github/app";
import { State } from "@notus/tasks/state";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { ConnectionObject } from "./objects/connection";
import { Durable } from "./objects/durable";

/** The Codex CLI login file shape: tokens only, no API key, no refresh token. */
const CodexAuthFile = Schema.fromJsonString(
  Schema.Struct({
    OPENAI_API_KEY: Schema.Null,
    tokens: Schema.Struct({
      id_token: Schema.NonEmptyString,
      access_token: Schema.NonEmptyString,
      refresh_token: Schema.Literal(""),
      account_id: Schema.NonEmptyString,
    }),
    last_refresh: Schema.NonEmptyString,
  }),
);

/**
 * Short-lived credentials a task hands its dev box: minted or refreshed outside the object's
 * gate, returned once, never persisted by the task. Each is absent rather than failing the task.
 */
const make = Effect.gen(function* () {
  const durable = yield* Durable.Service;
  const state = yield* State.Service;
  // Model logins and GitHub sign-ins stay in the initiator's Connection object.
  const connections = yield* ConnectionObject.Remote;
  // Absent configuration fails the checkout, never the object.
  const github = yield* Effect.serviceOption(GithubApp.Service);

  const initiator = durable
    .gate(state.snapshot.pipe(Effect.map((snapshot) => snapshot.task?.reservation.initiatorId)))
    .pipe(Effect.orElseSucceed(() => undefined));

  /** An App installation token for one checkout or push of one repository. */
  const repository = (repository: RepositoryRef, kind: "checkout" | "push") =>
    Option.isSome(github)
      ? github.value.forInstallation(repository.installationId).pipe(
          Effect.flatMap((app) =>
            kind === "checkout" ? app.readToken(repository) : app.pushToken(repository),
          ),
          // Non-secret: what GitHub granted for this one operation.
          Effect.tap((token) =>
            Effect.logInfo(
              `task.github_token ${kind} permissions=${Object.entries(token.granted.permissions)
                .map(([key, value]) => `${key}:${value}`)
                .join(
                  ",",
                )} repositories=${token.granted.repositories.join(",")} length=${Redacted.value(token.token).length}`,
            ),
          ),
          Effect.tapError((error) =>
            Effect.logWarning(
              `task.github_token_failed ${kind} ${error.operation} ${error.reason}${error.status === undefined ? "" : ` http=${error.status}`}`,
            ),
          ),
          Effect.map((token) => Redacted.value(token.token)),
          Effect.option,
        )
      : Effect.succeedNone;

  /** The initiator's GitHub sign-in for git on the box; null when they have none or it cannot be refreshed. */
  const githubLogin = (minimumLifetimeMs: number) =>
    Effect.gen(function* () {
      const initiatorId = yield* initiator;
      if (initiatorId === undefined) return null;

      const login = yield* connections(initiatorId).githubLogin(initiatorId, minimumLifetimeMs);

      if (!login.ok) {
        yield* Effect.logWarning(`task.github_login_failed ${login.reason}`);
        return null;
      }

      return login.value;
    }).pipe(Effect.catchCause(() => Effect.succeed(null)));

  /**
   * A Codex login file for one specialist round, from the initiator's agent connection. The
   * refresh token stays in the Connection object.
   */
  const agentLogin = (lifetimeMs: number) =>
    Effect.gen(function* () {
      const initiatorId = yield* initiator;
      if (initiatorId === undefined) return Option.none<string>();

      const login = yield* connections(initiatorId).agentLogin(initiatorId, lifetimeMs);

      if (!login.ok) {
        yield* Effect.logWarning(`task.agent_login_failed ${login.reason}`);
        return Option.none<string>();
      }

      const now = yield* Clock.currentTimeMillis;

      yield* Effect.logInfo(
        `task.agent_login expires_in_min=${Math.floor((login.value.expiresAt - now) / 60_000)}`,
      );

      const file = yield* Schema.encodeEffect(CodexAuthFile)({
        OPENAI_API_KEY: null,
        tokens: {
          id_token: login.value.idToken,
          access_token: login.value.access,
          refresh_token: "",
          account_id: login.value.accountId,
        },
        last_refresh: DateTime.formatIso(DateTime.makeUnsafe(now)),
      });

      return Option.some(file);
    }).pipe(Effect.catchCause(() => Effect.succeed(Option.none<string>())));

  return { repository, githubLogin, agentLogin };
});

export interface Interface extends Effect.Success<typeof make> {}

export class Service extends Context.Service<Service, Interface>()("@notus/control/Tokens") {}

export const layer = Layer.effect(Service, make);

export * as Tokens from "./tokens";

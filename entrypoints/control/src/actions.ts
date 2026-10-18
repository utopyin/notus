import type { CommandSpec } from "@notus/executions/types";
import { App as GithubApp } from "@notus/github/app";
import { InstallationId, PlatformId } from "@notus/platform/ids";
import { Platforms } from "@notus/platforms/registry";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

/** A command the control plane carries out itself. */
export interface Command {
  readonly id: string;
  readonly spec: Extract<CommandSpec, { readonly kind: "pull-request" | "update" }>;
}

const failed = (stderr: string) => ({
  exitCode: 1,
  stdout: "",
  stderr,
  durationMs: 0,
  timedOut: false,
  truncated: false,
});

const done = {
  exitCode: 0,
  stdout: "",
  stderr: "",
  durationMs: 0,
  timedOut: false,
  truncated: false,
};

/**
 * Control-plane actions: opening a pull request with the App's token, and posting a message in
 * the origin conversation. Each reports a command result, failures included.
 */
const make = Effect.gen(function* () {
  const platforms = yield* Platforms.Service;
  const github = yield* Effect.serviceOption(GithubApp.Service);

  const openPullRequest = (spec: Extract<CommandSpec, { readonly kind: "pull-request" }>) =>
    Option.isNone(github)
      ? Effect.succeed(failed("github-credential-unavailable"))
      : github.value.forInstallation(spec.repository.installationId).pipe(
          Effect.flatMap((app) =>
            app.createPullRequest(
              {
                owner: spec.repository.owner,
                name: spec.repository.name,
                defaultBranch: spec.base,
              },
              { branch: spec.branch, title: spec.title, body: spec.body },
            ),
          ),
          Effect.map((pull) => ({
            ...done,
            pullRequest: {
              number: pull.number,
              url: pull.url,
              branch: pull.branch,
              // The conversation this task opened, so feedback there can attach to it.
              source: {
                platform: "github" as const,
                installationId: InstallationId.make(spec.repository.installationId),
                scope: PlatformId.make(`${spec.repository.owner}/${spec.repository.name}`),
                conversation: PlatformId.make(String(pull.number)),
              },
            },
          })),
          Effect.catch((error) =>
            Effect.succeed(
              failed(
                `${error.operation} ${error.reason}${error.status === undefined ? "" : ` http=${error.status}`}${error.detail === undefined ? "" : ` (${error.detail})`}`,
              ),
            ),
          ),
        );

  /** The command id keeps the message idempotent across a lost acknowledgement. */
  const postUpdate = (id: string, spec: Extract<CommandSpec, { readonly kind: "update" }>) =>
    platforms.forInstallation(spec.target.source).pipe(
      Effect.flatMap((port) => port.conversations.resolveReply(spec.target)),
      Effect.flatMap((handle) => handle.reply(spec.text, id)),
      Effect.map((receipt) => ({ ...done, update: { reference: receipt.reference } })),
      Effect.catch((error) =>
        Effect.succeed(
          failed(
            error._tag === "Sources.SourceError"
              ? `update ${error.classification}`
              : "update unavailable",
          ),
        ),
      ),
    );

  const perform = (command: Command) =>
    command.spec.kind === "update"
      ? postUpdate(command.id, command.spec)
      : openPullRequest(command.spec);

  return { perform };
});

export class Service extends Context.Service<Service>()("@notus/control/Actions", { make }) {}

export const layer = Layer.effect(Service, Service.make);

export * as Actions from "./actions";

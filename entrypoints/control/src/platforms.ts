import { App as GithubApp } from "@notus/github/app";
import { GithubAdapter } from "@notus/platform-github/adapter";
import type { InstallError } from "@notus/platform/installing";
import { SlackAdapter } from "@notus/platform-slack/adapter";
import { Platforms } from "@notus/platforms/registry";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Redacted from "effect/Redacted";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import type { DashboardConfig, DeploymentConfig, GithubConfig } from "./config";

/**
 * The registry over this deployment's adapters: the Slack app and the GitHub App, each acting for
 * whichever installation the credential store knows. Both hosts build it from the same secrets;
 * the ingress host alone passes the webhook secret and the install clients, the Task host delivers only.
 */
export const platformsLayer = (
  config: DeploymentConfig,
  github: GithubConfig | null,
  install: {
    readonly webhookSecret: Redacted.Redacted<string> | null;
    readonly slack: DashboardConfig["slack"];
    readonly githubAppSlug: string | null;
    /** The installing user's GitHub user token; only the host that completes installs has one. */
    readonly githubInstaller:
      | ((userId: string) => Effect.Effect<Redacted.Redacted<string> | null, InstallError>)
      | null;
  },
) =>
  Platforms.layer(Effect.all([SlackAdapter.adapter, GithubAdapter.adapter])).pipe(
    Layer.provide([
      Layer.succeed(SlackAdapter.Configuration, {
        signingSecret: config.signingSecret,
        oauth: install.slack,
      }),
      // Without an App every GitHub operation fails closed as unsupported.
      github
        ? GithubApp.layer.pipe(
            Layer.provide([Layer.succeed(GithubApp.Configuration, github), FetchHttpClient.layer]),
          )
        : GithubApp.disabled,
      Layer.succeed(GithubAdapter.Configuration, {
        webhookSecret: install.webhookSecret,
        slug: install.githubAppSlug,
        installer: install.githubInstaller,
      }),
      FetchHttpClient.layer,
    ]),
    // A malformed App key or a platform registered twice is a deployment defect.
    Layer.orDie,
  );

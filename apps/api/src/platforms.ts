import { GithubAdapter } from "@notus/platform-github/adapter";
import { App as GithubApp } from "@notus/github/app";
import { SlackAdapter } from "@notus/platform-slack/adapter";
import { Slack } from "@notus/slack/service";
import { Platforms } from "@notus/platforms/registry";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Redacted from "effect/Redacted";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import type { DeploymentConfig, GithubConfig } from "./config";

/**
 * The registry over this deployment's adapters: Slack in the configured team, GitHub through the
 * configured App installation. Both hosts build it from the same secrets; the ingress host alone
 * passes the webhook secret, the Task host delivers only.
 */
export const platformsLayer = (
  config: DeploymentConfig,
  github: GithubConfig | null,
  webhookSecret: Redacted.Redacted<string> | null,
) =>
  Platforms.layer(Effect.all([SlackAdapter.adapter, GithubAdapter.adapter])).pipe(
    Layer.provide([
      Slack.layer.pipe(
        Layer.provide(
          Layer.succeed(Slack.Configuration, {
            token: config.token,
            allowedChannel: config.channelId,
          }),
        ),
      ),
      Layer.succeed(SlackAdapter.Configuration, {
        teamId: config.teamId,
        botUserId: config.botUserId,
        signingSecret: config.signingSecret,
      }),
      // Without an App every GitHub operation fails closed as unsupported.
      github
        ? GithubApp.layer.pipe(
            Layer.provide([Layer.succeed(GithubApp.Configuration, github), FetchHttpClient.layer]),
          )
        : GithubApp.disabled,
      Layer.succeed(GithubAdapter.Configuration, {
        installationId: github?.installationId ?? null,
        webhookSecret,
      }),
    ]),
    // A malformed App key or a platform registered twice is a deployment defect, not a request error.
    Layer.orDie,
  );

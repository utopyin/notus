import { Failure as AuthenticationFailure } from "@notus/control/runtime/auth";
import { Mode } from "@notus/executions/types";
import { Provider } from "@notus/openai/types";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

// Alchemy captures these Config reads during construction and reifies them
// from Worker secret bindings at runtime. Never read process.env in handlers.
export const deploymentConfig = Effect.gen(function* () {
  const mode = yield* Config.schema(Mode, "NOTUS_MODE").pipe(Config.withDefault("simulation"));
  return {
    mode,
    workspaceId: yield* Config.schema(Schema.NonEmptyString, "NOTUS_WORKSPACE_ID"),
    teamId: yield* Config.schema(Schema.NonEmptyString, "SLACK_TEAM_ID"),
    channelId: yield* Config.schema(Schema.NonEmptyString, "SLACK_CHANNEL_ID"),
    botUserId: yield* Config.schema(Schema.NonEmptyString, "SLACK_BOT_USER_ID"),
    canonicalUserId: yield* Config.schema(Schema.NonEmptyString, "NOTUS_FIXTURE_USER_ID"),
    externalUserId: yield* Config.schema(Schema.NonEmptyString, "NOTUS_FIXTURE_SLACK_USER_ID"),
    signingSecret: yield* Config.redacted("SLACK_SIGNING_SECRET"),
    token: yield* Config.redacted("SLACK_BOT_TOKEN"),
    simulationDelayMs: 2_000,
    claimTtlMs: 60_000,
  };
});
export type DeploymentConfig = Effect.Success<typeof deploymentConfig>;

/** Separate from Slack configuration and never spread into task-domain settings. */
export const runtimeConfig = Effect.gen(function* () {
  const url = yield* Config.option(Config.string("NOTUS_CONTROL_URL"));
  if (Option.isNone(url)) return null;
  const encodedKeys = yield* Config.redacted("NOTUS_RUNTIME_KEYS");
  const decoded = yield* Schema.decodeEffect(
    Schema.fromJsonString(Schema.Record(Schema.String, Schema.NonEmptyString)),
  )(Redacted.value(encodedKeys)).pipe(
    Effect.mapError(() => new AuthenticationFailure({ reason: "configuration" })),
  );
  return {
    controlUrl: url.value,
    activeKeyId: yield* Config.schema(Schema.NonEmptyString, "NOTUS_RUNTIME_KEY_ID"),
    keys: Object.fromEntries(
      Object.entries(decoded).map(([id, value]) => [id, Redacted.make(value)]),
    ),
  };
});
export type RuntimeConfig = NonNullable<Effect.Success<typeof runtimeConfig>>;

/**
 * Read by the Task and Connection hosts. Contains no credentials. The subscription backend
 * is the default; Platform API billing must be selected explicitly.
 */
export const operatorConfig = Effect.gen(function* () {
  return {
    provider: yield* Config.schema(Provider, "NOTUS_MODEL_PROVIDER").pipe(
      Config.withDefault("openai-chatgpt"),
    ),
    model: yield* Config.schema(Schema.NonEmptyString, "NOTUS_MODEL").pipe(
      Config.withDefault("gpt-5.4"),
    ),
    maxOutputTokens: 2_000,
    reasoningEffort: yield* Config.schema(
      Schema.Literals(["minimal", "low", "medium", "high"]),
      "NOTUS_REASONING_EFFORT",
    ).pipe(Config.withDefault("low")),
  };
});
export type OperatorConfig = Effect.Success<typeof operatorConfig>;

/**
 * Read only by the Connection host. An explicit administrator-supplied login for the fixture
 * user, linked once; rotation afterwards lives in the Connection object, never in this value.
 */
export const fixtureConnection = Effect.gen(function* () {
  const login = yield* Config.option(Config.redacted("NOTUS_FIXTURE_CHATGPT_OAUTH"));
  const apiKey = yield* Config.option(Config.redacted("NOTUS_FIXTURE_OPENAI_API_KEY"));
  // The ChatGPT login dev box agents run under. Separate from the operator's model connection.
  const agentLogin = yield* Config.option(Config.redacted("NOTUS_FIXTURE_AGENT_LOGIN"));
  return {
    login: Option.getOrNull(login),
    apiKey: Option.getOrNull(apiKey),
    agentLogin: Option.getOrNull(agentLogin),
  };
});

/**
 * The dedicated GitHub App and the fixture repository. Read by the Task host only when the
 * runtime claims a checkout; the key never reaches prompts, storage or the dev box.
 */
// Numeric identifiers may arrive as numbers or strings depending on how the value was packed.
const Identifier = Schema.Union([Schema.String, Schema.Int]);
export const githubConfig = Effect.gen(function* () {
  const appId = yield* Config.option(Config.schema(Identifier, "GITHUB_APP_ID"));
  if (Option.isNone(appId)) return null;
  const installationId = yield* Config.schema(Identifier, "GITHUB_APP_INSTALLATION_ID");
  return {
    appId: String(appId.value),
    installationId: String(installationId),
    privateKey: yield* Config.redacted("GITHUB_APP_PRIVATE_KEY"),
  };
});
export type GithubConfig = NonNullable<Effect.Success<typeof githubConfig>>;
const RepositoryName = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/),
);
/**
 * Dev-stage seeds for the fixture workspace: a covered repository and the fixture user's GitHub
 * login. Tasks take their repositories from the workspace's covered scopes, never from here.
 */
export const fixtureRepositoryConfig = Effect.gen(function* () {
  const fullName = yield* Config.option(Config.schema(RepositoryName, "NOTUS_FIXTURE_REPOSITORY"));
  const login = yield* Config.option(
    Config.schema(
      Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/)),
      "NOTUS_FIXTURE_GITHUB_LOGIN",
    ),
  );
  return {
    fullName: Option.getOrNull(fullName),
    githubLogin: Option.getOrNull(login),
  };
});
/**
 * Dashboard sign-in: the Slack app's and the GitHub App's OAuth clients, and the dashboard's
 * public origin once known. A provider without credentials is simply not offered.
 */
export const dashboardConfig = Effect.gen(function* () {
  const slackId = yield* Config.option(Config.string("SLACK_CLIENT_ID"));
  const slackSecret = yield* Config.option(Config.redacted("SLACK_CLIENT_SECRET"));
  const githubId = yield* Config.option(Config.string("GITHUB_OAUTH_CLIENT_ID"));
  const githubSecret = yield* Config.option(Config.redacted("GITHUB_OAUTH_CLIENT_SECRET"));
  const origin = yield* Config.option(Config.string("NOTUS_DASHBOARD_URL"));
  const githubAppSlug = yield* Config.option(Config.string("GITHUB_APP_SLUG"));
  return {
    /** The public name of the GitHub App, for its installation page; absent means no install offer. */
    githubAppSlug: Option.getOrNull(githubAppSlug),
    slack:
      Option.isSome(slackId) && Option.isSome(slackSecret)
        ? { clientId: slackId.value, clientSecret: slackSecret.value }
        : null,
    github:
      Option.isSome(githubId) && Option.isSome(githubSecret)
        ? { clientId: githubId.value, clientSecret: githubSecret.value }
        : null,
    origin: Option.isSome(origin) ? origin.value.replace(/\/$/, "") : null,
  };
});
export type DashboardConfig = Effect.Success<typeof dashboardConfig>;

export const webhookConfig = Effect.gen(function* () {
  return Option.getOrNull(yield* Config.option(Config.redacted("GITHUB_WEBHOOK_SECRET")));
});

/** Read only by the execution host, not the Slack ingress or the devbox. */
export const providerConfig = Effect.gen(function* () {
  return {
    credential: yield* Config.redacted("NAMESPACE_CONTROL_TOKEN"),
    approvedImageRef: yield* Config.schema(Schema.NonEmptyString, "NOTUS_APPROVED_IMAGE_REF"),
    // Set only after auditing both executable contents and provider registration metadata.
    imageAudit: yield* Config.schema(
      Schema.Literal("audited-no-checkout-or-startup"),
      "NOTUS_IMAGE_AUDIT",
    ),
    timeoutMs: 20_000,
  };
});

import { Failure as AuthenticationFailure } from "./runtime/auth";
import { Provider } from "@notus/compute/provider";
import { Mode } from "@notus/executions/types";
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
    /** The Slack app's signing secret: one app, installed per workspace from the dashboard. */
    signingSecret: yield* Config.Redacted("SLACK_SIGNING_SECRET"),
    simulationDelayMs: 2_000,
    claimTtlMs: 60_000,
  };
});
export type DeploymentConfig = Effect.Success<typeof deploymentConfig>;

export const runtimeConfig = Effect.gen(function* () {
  const url = yield* Config.option(Config.String("NOTUS_CONTROL_URL"));

  if (Option.isNone(url)) return null;

  const encodedKeys = yield* Config.Redacted("NOTUS_RUNTIME_KEYS");

  const decoded = yield* Schema.decodeEffect(
    Schema.fromJsonString(Schema.Record(Schema.String, Schema.NonEmptyString)),
  )(Redacted.value(encodedKeys)).pipe(
    // A malformed key set is a deployment defect.
    Effect.mapError(() => new AuthenticationFailure({ reason: "configuration" })),
    Effect.orDie,
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
 * Read by the Task host. Contains no credentials. The operator always runs on the Platform API
 * with the initiator's key: the subscription backend refuses Cloudflare egress, so a ChatGPT
 * login serves Codex on the dev box only.
 */
export const operatorConfig = Effect.gen(function* () {
  return {
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

/** Seals every credential at rest: model logins and platform installations. 32 bytes, base64. */
export const credentialKeyConfig = Config.Redacted("NOTUS_CREDENTIAL_KEY");

/**
 * The dedicated GitHub App. Installations are workspace data; the key never reaches prompts,
 * storage or the dev box.
 */
// Numeric identifiers may arrive as numbers or strings depending on how the value was packed.
const Identifier = Schema.Union([Schema.String, Schema.Int]);

export const githubConfig = Effect.gen(function* () {
  const appId = yield* Config.option(Config.schema(Identifier, "GITHUB_APP_ID"));
  if (Option.isNone(appId)) return null;

  return {
    appId: String(appId.value),
    privateKey: yield* Config.Redacted("GITHUB_APP_PRIVATE_KEY"),
  };
});
export type GithubConfig = NonNullable<Effect.Success<typeof githubConfig>>;
/**
 * Dashboard sign-in: the Slack app's and the GitHub App's OAuth clients, and the dashboard's
 * public origin once known. Only providers with credentials are offered.
 */
export const dashboardConfig = Effect.gen(function* () {
  const slackId = yield* Config.option(Config.String("SLACK_CLIENT_ID"));
  const slackSecret = yield* Config.option(Config.Redacted("SLACK_CLIENT_SECRET"));
  const githubId = yield* Config.option(Config.String("GITHUB_OAUTH_CLIENT_ID"));
  const githubSecret = yield* Config.option(Config.Redacted("GITHUB_OAUTH_CLIENT_SECRET"));
  const origin = yield* Config.option(Config.String("NOTUS_DASHBOARD_URL"));
  const githubAppSlug = yield* Config.option(Config.String("GITHUB_APP_SLUG"));

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
  return Option.getOrNull(yield* Config.option(Config.Redacted("GITHUB_WEBHOOK_SECRET")));
});

/**
 * Which devbox providers this deployment runs, comma-separated; Namespace alone by default.
 * Deployment authority: each workspace still connects its own account.
 */
export const computeConfig = Effect.gen(function* () {
  const listed = yield* Config.String("NOTUS_COMPUTE_PROVIDERS").pipe(
    Config.withDefault("namespace"),
  );

  // An unknown or repeated provider is a deployment defect.
  return yield* Schema.decodeUnknownEffect(Schema.UniqueArray(Provider))(
    listed
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value !== ""),
  ).pipe(Effect.orDie);
});

import { Failure as AuthenticationFailure } from "@notus/control/runtime/auth";
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

/** Read by the Task host for operator turns. Contains no credentials. */
export const operatorConfig = Effect.gen(function* () {
  return {
    model: yield* Config.schema(Schema.NonEmptyString, "NOTUS_MODEL").pipe(
      Config.withDefault("gpt-5.4"),
    ),
    maxOutputTokens: 2_000,
    reasoningEffort: "low" as const,
  };
});
export type OperatorConfig = Effect.Success<typeof operatorConfig>;

/**
 * Read only by the Connection host. An explicit administrator-supplied login for the fixture
 * user, linked once; rotation afterwards lives in the Connection object, never in this value.
 */
export const fixtureConnection = Effect.gen(function* () {
  const login = yield* Config.option(Config.redacted("NOTUS_FIXTURE_CHATGPT_OAUTH"));
  return Option.getOrNull(login);
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

import { snapshot } from "@notus/contracts/json";
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { ConfigError } from "./errors";
import type { Configuration, RawJson } from "./types";
import { CreateSettings } from "./wire";

export interface Interface {
  readonly credential: Redacted.Redacted<string>;
  readonly endpoint?: string;
  // Trusted host origin for ComputeService, never read from reusable devbox JSON.
  readonly computeEndpoint?: string;
  readonly timeoutMs: number;
}
export class Service extends Context.Service<Service, Interface>()("@notus/namespace/Config") {}
export const layer = (settings: Interface) => Layer.succeed(Service, settings);
export const defaultEndpoint = "https://private-api.iad.namespaceapis.com";
export const defaultComputeEndpoint = "https://us.compute.namespaceapis.com";

const forbidden = new Set([
  "name",
  "activate",
  "activateExperimental",
  "activate_experimental",
  "templateId",
  "template_id",
  "blueprintId",
  "blueprint_id",
  "blueprint",
  "fromDevbox",
  "from_devbox",
  "onCreate",
  "onStartup",
  "onStart",
  "spec",
  "bootstrap",
  "credentials",
]);
const sensitive = new Set([
  "connectToken",
  "connect_token",
  "privateSshKey",
  "private_ssh_key",
  "bootstrapToken",
  "bootstrap_token",
  "bootstrapCredentials",
  "bootstrap_credentials",
  "bearerToken",
  "bearer_token",
]);
// Accept canonical protobuf JSON keys only. Aliases could bypass known-field validation.
const aliases = new Set(
  [
    ...Object.keys(CreateSettings.fields),
    "virtualCpu",
    "memoryMegabytes",
    "machineArch",
    "gitRepository",
    "checkoutMethod",
    "fromSecretId",
    "egressDomains",
    "egressPolicy",
    "fromSpec",
    "stoppedRetentionDuration",
  ]
    .filter((key) => /[A-Z]/.test(key))
    .map((key) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)),
);

const containsUnsafeKey = (value: RawJson): boolean => {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsUnsafeKey);

  return Object.entries(value).some(
    ([key, child]) => sensitive.has(key) || aliases.has(key) || containsUnsafeKey(child),
  );
};

export const decode = Effect.fn("Namespace.Config.decode")(function* (
  input: RawJson,
): Effect.fn.Return<Configuration, ConfigError> {
  const independent = yield* snapshot(input).pipe(
    Effect.mapError(() => new ConfigError({ message: "Expected inert JSON settings" })),
  );

  if (
    independent === null ||
    typeof independent !== "object" ||
    Arr.isArray<RawJson>(independent)
  ) {
    return yield* new ConfigError({
      message: "Expected a JSON object for Namespace CreateRequest settings",
    });
  }

  const raw = independent;

  if (Object.keys(raw).some((key) => forbidden.has(key)) || containsUnsafeKey(raw)) {
    return yield* new ConfigError({
      message:
        "Runtime identity, activation, templates, hooks, bootstrap credentials and noncanonical field aliases are not reusable CreateRequest settings",
    });
  }

  // Model-account integration is not part of base-image startup authority.
  const integrations = raw.integrations;

  if (integrations !== null && typeof integrations === "object" && "claude" in integrations) {
    return yield* new ConfigError({ message: "Model integrations are unsupported" });
  }

  yield* Schema.decodeEffect(CreateSettings)(raw).pipe(
    Effect.mapError(
      () =>
        new ConfigError({
          message:
            "Invalid native CreateRequest settings: check image/shape alternatives, field types, environment sources and reserved or duplicate names",
        }),
    ),
  );

  return Object.freeze({ raw });
});

export const encode = Effect.fn("Namespace.Config.encode")(function* (
  config: Configuration,
): Effect.fn.Return<RawJson, ConfigError> {
  return (yield* decode(config.raw)).raw;
});

export * as Config from "./config";

import type * as Effect from "effect/Effect";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import type { CapabilityNotSupportedError } from "./capabilities";
import type { ProviderDescriptor } from "./descriptor";
import type { ComputeError, ConfigurationError } from "./errors";
import type { Provider } from "./provider";

/** A provider's box as Notus stores it. The image observation stays opaque and is never a status payload. */
export const Resource = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  /** The machine currently backing the resource; a wake may replace it. Null while none runs. */
  instanceId: Schema.NullOr(Schema.NonEmptyString),
  image: Schema.NullOr(Schema.Json),
});
export interface Resource extends Schema.Schema.Type<typeof Resource> {}

export const State = Schema.Literals(["running", "stopped", "ended", "unknown"]);
export type State = typeof State.Type;

/** What the provider last said about a resource; never continuous health. */
export interface Observation {
  readonly resource: Resource;
  readonly state: State;
}

/** The provider's receipt that one exact earlier machine ended. */
export interface Termination {
  readonly instanceId: string;
  readonly endedAt: string;
}

/**
 * Every provider delivers `NOTUS_CONTROL_URL` and `NOTUS_BOOTSTRAP_TOKEN` to the box and runs
 * `/usr/local/bin/notus-devbox start` as a process it restarts after a wake. How is its own concern.
 */
export interface Launch {
  /** Stable and unique per operation, so a lost result can be recovered by name. */
  readonly name: string;
  readonly operationId: string;
  /** The workspace's native configuration, decoded by the adapter alone. */
  readonly config: Schema.Json;
  readonly bootstrap: {
    readonly controlUrl: string;
    readonly credential: Redacted.Redacted<string>;
  };
}

/** What an adapter does for one workspace; every value is a plain closure over its configuration. */
export interface DevboxPort {
  readonly launch: (input: Launch) => Effect.Effect<Resource, ConfigurationError | ComputeError>;
  /** Looks for a resource whose create result was lost. Finding one is evidence, never adoption. */
  readonly recover: (name: string, operationId: string) => Effect.Effect<void, ComputeError>;
  readonly fetch: (resource: Resource) => Effect.Effect<Observation, ComputeError>;
  readonly wake: (
    resource: Resource,
  ) => Effect.Effect<Observation, ComputeError | CapabilityNotSupportedError>;
  readonly sleep: (
    resource: Resource,
  ) => Effect.Effect<Observation, ComputeError | CapabilityNotSupportedError>;
  readonly end: (resource: Resource) => Effect.Effect<void, ComputeError>;
  readonly proveReplacement: (
    previousInstanceId: string,
  ) => Effect.Effect<Termination, ComputeError | CapabilityNotSupportedError>;
}

/** Checks that need no credential, so the API refuses a save before anything is connected. */
export interface Configuration {
  /** The configuration must select one of `templates`, the workspace's own. */
  readonly validate: (
    config: Schema.Json,
    templates: ReadonlyArray<string>,
  ) => Effect.Effect<void, ConfigurationError>;
  /** The normalized reference, or why the provider cannot start from it. */
  readonly validateTemplate: (ref: string) => Effect.Effect<string, ConfigurationError>;
}

export interface ProviderAdapter {
  readonly provider: Provider;
  readonly descriptor: ProviderDescriptor;
  readonly configuration: Configuration;
  readonly forWorkspace: (workspaceId: string) => Effect.Effect<DevboxPort>;
}

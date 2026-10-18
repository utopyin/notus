import type * as Effect from "effect/Effect";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import type { CapabilityNotSupportedError } from "./capabilities";
import type { ProviderDescriptor } from "./descriptor";
import type { ComputeError, ConfigurationError, ConnectionError } from "./errors";
import type { Provider } from "./provider";
import type { TemplateSet } from "./templates";

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

/**
 * Where a template build stands. `progress` is the adapter's own JSON, which the host stores
 * between steps and hands back unread; null before the first step.
 */
export interface Build {
  /** Stable per build, so a step retried after a lost answer finds what it already made. */
  readonly operationId: string;
  readonly progress: Schema.Json | null;
}

/** What one build step left: more to do after a pause, a template to launch from, or a refusal. */
export type BuildStep =
  | { readonly _tag: "Continue"; readonly progress: Schema.Json; readonly afterMs: number }
  | { readonly _tag: "Ready"; readonly ref: string }
  /** The provider refused the build for good; the adapter already removed what it made. */
  | { readonly _tag: "Failed"; readonly reason: string };

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
  /**
   * While the box works, keeps it from stopping for at least `seconds`; with null, the work ended
   * and the configuration's own idle stop applies from now. `config` is the configuration the box
   * launched with. Never shortens a deadline the configuration does not set.
   */
  readonly hold: (
    resource: Resource,
    config: Schema.Json,
    seconds: number | null,
  ) => Effect.Effect<void, ConfigurationError | ComputeError | CapabilityNotSupportedError>;
  /** That the machine `previousInstanceId` names ended, now that `resource` runs on another. */
  readonly proveReplacement: (
    resource: Resource,
    previousInstanceId: string,
  ) => Effect.Effect<Termination, ComputeError | CapabilityNotSupportedError>;
  /**
   * Takes the Notus template build one step further in the workspace's own account. Each step is
   * safe to run again with the same input, so a failed or lost step is simply retried.
   */
  readonly build: (
    build: Build,
  ) => Effect.Effect<BuildStep, ComputeError | CapabilityNotSupportedError>;
  /** Removes what an unfinished build made, once the host gives up on it. */
  readonly discardBuild: (
    build: Build,
  ) => Effect.Effect<void, ComputeError | CapabilityNotSupportedError>;
}

/** Checks that need no credential, so the API refuses a save before anything is connected. */
export interface Configuration {
  /**
   * The configuration must select one of the workspace's templates, or select none and leave it
   * to the default.
   */
  readonly validate: (
    config: Schema.Json,
    templates: TemplateSet,
  ) => Effect.Effect<void, ConfigurationError>;
  /** The normalized reference, or why the provider cannot start from it. */
  readonly validateTemplate: (ref: string) => Effect.Effect<string, ConfigurationError>;
  /**
   * The normalized account JSON an admin submitted, checked for shape only: nothing is sent to
   * the provider. The result is what the workspace stores, sealed.
   */
  readonly validateConnection: (
    input: Schema.Json,
  ) => Effect.Effect<Schema.Json, ConfigurationError>;
  /** The template a launch uses when the configuration selects none: the admins' pick, or an inferred one. */
  readonly defaultOf: (templates: TemplateSet) => string | null;
}

export interface ProviderAdapter {
  readonly provider: Provider;
  readonly descriptor: ProviderDescriptor;
  readonly configuration: Configuration;
  /** Reads the workspace's connection first; without one, nothing reaches the provider. */
  readonly forWorkspace: (workspaceId: string) => Effect.Effect<DevboxPort, ConnectionError>;
}

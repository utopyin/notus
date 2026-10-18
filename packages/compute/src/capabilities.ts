import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Provider } from "./provider";

/**
 * What Notus may decide on about a provider's boxes. A provider's own concepts (blueprints,
 * shapes, sizes, sites) stay in its native configuration. Append-only in meaning: a retired
 * capability is never repurposed, a new value is added instead.
 */
export const Capability = Schema.Literals([
  /** The provider stops an idle box by itself; Notus does nothing while a task waits. */
  "sleep:auto",
  /** Notus can stop a box and keep its disk for a later wake. */
  "sleep:request",
  /** Notus can start a stopped box again on the same resource. */
  "wake:request",
  /** The box can tell the provider it is busy, so a running command is never stopped as idle. */
  "busy:signal",
  /** The provider can prove the previous machine ended before a new one enrolls on the resource. */
  "replacement:proof",
  /**
   * Notus can hold a working box awake for a bounded time by moving the provider's own stop
   * deadline, and hand it back to the configured idle stop afterwards. The hold is renewed; a
   * missed renewal lets the provider stop the box.
   */
  "activity:lease",
  /**
   * Notus can build the Notus base template in the workspace's own account from the recipe it
   * ships, so a workspace that connects has something to launch without building it by hand.
   */
  "template:build",
]);
export type Capability = typeof Capability.Type;

/** The capabilities of one provider. */
export class Capabilities extends Schema.Class<Capabilities>("Compute.Capabilities")({
  provider: Provider,
  values: Schema.Array(Capability),
}) {
  has(capability: Capability): boolean {
    return this.values.includes(capability);
  }
  /** Fails, so a skipped check is a type error at the call site. */
  ensure(capability: Capability): Effect.Effect<void, CapabilityNotSupportedError> {
    return this.has(capability)
      ? Effect.void
      : Effect.fail(new CapabilityNotSupportedError({ provider: this.provider, capability }));
  }
}

/** Declared here because errors.ts imports Capability; the reverse import would cycle. */
export class CapabilityNotSupportedError extends Schema.TaggedError<CapabilityNotSupportedError>()(
  "Compute.CapabilityNotSupported",
  { provider: Provider, capability: Capability },
) {}

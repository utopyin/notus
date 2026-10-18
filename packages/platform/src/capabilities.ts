import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Platform } from "./platform";

/**
 * What an installation can do on its platform. Append-only in meaning: a retired capability is
 * never repurposed, a new value is added instead.
 */
export const Capability = Schema.Literals([
  /** A mention or message in scope may start a task. */
  "input:start",
  /** Messages in an attached conversation are inputs. */
  "input:message",
  /** Reviews and review comments are inputs. */
  "input:review",
  /** Progress and decisions can be posted to the conversation. */
  "output:update",
  /** An input can be answered at its own target. */
  "output:reply",
  /** An input can be acknowledged with a reaction. */
  "output:react",
  /** The installation can enumerate the scopes it may act in. */
  "scope:list",
  /** Notus can open a conversation of its own, such as a pull request. */
  "conversation:open",
]);
export type Capability = typeof Capability.Type;

/** The capabilities of one platform, or of one attachment after narrowing. */
export class Capabilities extends Schema.Class<Capabilities>("Sources.Capabilities")({
  platform: Platform,
  values: Schema.Array(Capability),
}) {
  has(capability: Capability): boolean {
    return this.values.includes(capability);
  }
  /** Fails, so a skipped check is a type error at the call site. */
  ensure(capability: Capability): Effect.Effect<void, CapabilityNotSupportedError> {
    return this.has(capability)
      ? Effect.void
      : Effect.fail(new CapabilityNotSupportedError({ platform: this.platform, capability }));
  }
}

/** Declared here because errors.ts imports Capability; the reverse import would cycle. */
export class CapabilityNotSupportedError extends Schema.TaggedError<CapabilityNotSupportedError>()(
  "Sources.CapabilityNotSupported",
  { platform: Platform, capability: Capability },
) {}

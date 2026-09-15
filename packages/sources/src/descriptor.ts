import type { Capabilities } from "./capabilities";
import type { Platform } from "./platform";
import type { Scope } from "./source";

/** A stable key the dashboard resolves to a brand mark. Not a component: the server imports this too. */
export type PlatformIconKey = "slack" | "github";

/**
 * Everything generic code needs to present a platform without knowing which one it is. Every
 * field is pure data or a pure function over its arguments; anything needing a client or a token
 * belongs on the adapter's installation surfaces. That is what keeps a descriptor usable from the
 * browser for a platform the workspace has not connected.
 */
export interface PlatformDescriptor<P extends Platform = Platform> {
  readonly platform: P;
  /** How the platform is named in the product. */
  readonly name: string;
  readonly icon: PlatformIconKey;
  /** What a scope is called in this platform: "channel", "repository". */
  readonly scopeNoun: string;
  /** How a scope is written for display: "#general", "acme/api". */
  readonly scopeLabel: (scope: Pick<Scope, "id" | "label">) => string;
  /** The platform baseline; an attachment narrows it. */
  readonly capabilities: Capabilities;
}

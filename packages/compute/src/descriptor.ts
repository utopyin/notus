import type { Capabilities } from "./capabilities";
import type { Provider } from "./provider";

/** A stable key the dashboard resolves to a brand mark. Not a component: the server imports this too. */
export type ProviderIconKey = "namespace" | "boat";

/**
 * Everything generic code needs to present a provider and decide about its boxes without knowing
 * which one it is. Pure data only: anything needing a client or a credential belongs on the
 * adapter's port, which keeps a descriptor usable from the browser.
 */
export interface ProviderDescriptor<P extends Provider = Provider> {
  readonly provider: P;
  /** How the provider is named in the product. */
  readonly name: string;
  readonly icon: ProviderIconKey;
  /** The provider's baseline; the adapter still enforces each one before any I/O. */
  readonly capabilities: Capabilities;
  /** What a box starts from on this provider: an image, a snapshot. */
  readonly template: {
    readonly noun: { readonly one: string; readonly many: string };
    /** How a reference is written, for an input's placeholder. */
    readonly placeholder: string;
  };
  /** What an admin pastes to connect the workspace's own account. */
  readonly connection: {
    readonly label: string;
    readonly placeholder: string;
    /** Where the admin finds it, in one sentence. */
    readonly help: string;
  };
}

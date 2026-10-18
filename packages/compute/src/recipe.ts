import * as Context from "effect/Context";
import type { Provider } from "./provider";

/** One file of the Notus base recipe, as the deployment ships it. */
export interface RecipeFile {
  /** A plain file name; the adapter decides where it goes on the machine. */
  readonly name: string;
  readonly content: string;
}

/**
 * The Notus base recipe this deployment ships for each provider that builds its own template: the
 * provider's install script and unit, the supervisor bundle and its launcher. Host-provided, so the
 * template a workspace builds carries the supervisor its control plane speaks to.
 */
export interface Interface {
  readonly files: (provider: Provider) => ReadonlyArray<RecipeFile>;
}
export class Recipe extends Context.Service<Recipe, Interface>()("@notus/compute/Recipe") {}

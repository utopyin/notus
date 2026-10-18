import type { Configuration, ProviderAdapter } from "@notus/compute/adapter";
import type { ComputeCredentials } from "@notus/compute/credentials";
import { Provider, PROVIDERS } from "@notus/compute/provider";
import type { Recipe } from "@notus/compute/recipe";
import type { Templates } from "@notus/compute/templates";
import {
  adapter as boatAdapter,
  configuration as boatConfiguration,
} from "@notus/compute-boat/adapter";
import {
  adapter as namespaceAdapter,
  configuration as namespaceConfiguration,
} from "@notus/compute-namespace/adapter";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/** Every adapter this build has. Total over `Provider`, so a new provider does not compile without one. */
const adapters: {
  readonly [P in Provider]: Effect.Effect<
    ProviderAdapter,
    never,
    ComputeCredentials | Templates | Recipe
  >;
} = { namespace: namespaceAdapter, boat: boatAdapter };

/** The same providers' credential-free checks. */
const configurations: { readonly [P in Provider]: Configuration } = {
  namespace: namespaceConfiguration,
  boat: boatConfiguration,
};

/** The adapters a deployment runs (`NOTUS_COMPUTE_PROVIDERS`), registered with the task host. */
export const adaptersOf = (enabled: ReadonlyArray<Provider>) =>
  Effect.forEach(enabled, (provider) => adapters[provider]);
/** A provider the deployment does not run is refused before storage, like an unknown key. */
export const configurationOf = (
  enabled: ReadonlyArray<Provider>,
  provider: string,
): Configuration | null =>
  Schema.is(Provider)(provider) && enabled.includes(provider) ? configurations[provider] : null;
/** What the dashboard offers, in the vocabulary's order. */
export const offered = (enabled: ReadonlyArray<Provider>): ReadonlyArray<Provider> =>
  PROVIDERS.filter((provider) => enabled.includes(provider));

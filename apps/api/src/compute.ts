import type { Configuration } from "@notus/compute/adapter";
import { Provider } from "@notus/compute/provider";
import {
  adapter as namespaceAdapter,
  configuration as namespaceConfiguration,
} from "@notus/compute-namespace/adapter";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/** The devbox providers this deployment runs. Adding one here registers it with the task host. */
export const adapters = Effect.all([namespaceAdapter]);

/** The same providers' credential-free checks, for the API's saves. Total over `Provider`. */
const configurations: { readonly [P in Provider]: Configuration } = {
  namespace: namespaceConfiguration,
};
export const configurationOf = (provider: string): Configuration | null =>
  Schema.is(Provider)(provider) ? configurations[provider] : null;

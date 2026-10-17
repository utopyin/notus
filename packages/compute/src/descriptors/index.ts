import type { ProviderDescriptor } from "../descriptor";
import { Provider } from "../provider";
import { BOAT_DESCRIPTOR } from "./boat";
import { NAMESPACE_DESCRIPTOR } from "./namespace";
import * as Schema from "effect/Schema";

/** Total over `Provider`: a provider without a descriptor is a compile error here. */
export const PROVIDER_DESCRIPTORS: { readonly [P in Provider]: ProviderDescriptor<P> } = {
  namespace: NAMESPACE_DESCRIPTOR,
  boat: BOAT_DESCRIPTOR,
};

/** The descriptor of a stored provider key; none for a key this build does not know. */
export const descriptorOf = (provider: string): ProviderDescriptor | null =>
  Schema.is(Provider)(provider) ? PROVIDER_DESCRIPTORS[provider] : null;

export { BOAT_DESCRIPTOR, NAMESPACE_DESCRIPTOR };

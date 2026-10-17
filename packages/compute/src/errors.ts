import * as Schema from "effect/Schema";
import { Provider } from "./provider";

export class ProviderNotRegisteredError extends Schema.TaggedError<ProviderNotRegisteredError>()(
  "Compute.ProviderNotRegistered",
  { provider: Schema.String },
) {}
export class DuplicateProviderRegistrationError extends Schema.TaggedError<DuplicateProviderRegistrationError>()(
  "Compute.DuplicateProviderRegistration",
  { provider: Provider },
) {}
export { CapabilityNotSupportedError } from "./capabilities";

/** Native configuration or a template reference the provider refuses; the message is user-facing. */
export class ConfigurationError extends Schema.TaggedError<ConfigurationError>()(
  "Compute.ConfigurationError",
  { provider: Provider, message: Schema.String },
) {}

/**
 * A provider call that did not succeed. `notSent` and `rejected` changed nothing; `notFound` means
 * the resource is not there; `unknown` may have changed provider state, so the caller reconciles
 * before another mutation and never retries it blindly. Provider bodies and causes stay out.
 */
export class ComputeError extends Schema.TaggedError<ComputeError>()("Compute.ComputeError", {
  provider: Provider,
  operation: Schema.Literals(["launch", "recover", "fetch", "wake", "sleep", "end", "proof"]),
  outcome: Schema.Literals(["notSent", "rejected", "notFound", "unknown"]),
}) {}

import * as Schema from "effect/Schema";
import { InstallationId } from "./ids";
import { Platform } from "./platform";

export class PlatformNotRegisteredError extends Schema.TaggedError<PlatformNotRegisteredError>()(
  "Sources.PlatformNotRegistered",
  { platform: Platform },
) {}
export class DuplicatePlatformRegistrationError extends Schema.TaggedError<DuplicatePlatformRegistrationError>()(
  "Sources.DuplicatePlatformRegistration",
  { platform: Platform },
) {}
export class InstallationNotFound extends Schema.TaggedError<InstallationNotFound>()(
  "Sources.InstallationNotFound",
  { platform: Platform, installationId: InstallationId },
) {}
export { CapabilityNotSupportedError } from "./capabilities";
/**
 * A delivery the adapter could not accept. `signature` and `envelope` are the sender's fault;
 * `unconfigured` means this deployment has no way to verify the platform at all.
 */
export class IngressError extends Schema.TaggedError<IngressError>()("Sources.IngressError", {
  platform: Platform,
  reason: Schema.Literals(["signature", "envelope", "unconfigured"]),
}) {}
/** A timed-out or undecodable write may have landed, so it is ambiguous, never retried blindly. */
export class SourceError extends Schema.TaggedError<SourceError>()("Sources.SourceError", {
  classification: Schema.Literals(["unsupported", "rate-limited", "rejected", "ambiguous"]),
  retryAfter: Schema.optionalKey(Schema.Finite),
}) {}

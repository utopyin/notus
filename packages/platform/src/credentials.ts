import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { InstallationRef } from "./ids";

export class CredentialError extends Schema.TaggedError<CredentialError>()(
  "Sources.CredentialError",
  { operation: Schema.String, cause: Schema.optionalKey(Schema.Unknown) },
) {}

/**
 * What an installation left behind when it was connected, as opaque JSON: a bot token and bot
 * user for a Slack team, nothing for a GitHub App installation. Only the owning adapter decodes
 * it; the host stores it and never projects it anywhere.
 */
export interface Interface {
  readonly get: (
    ref: InstallationRef,
  ) => Effect.Effect<Option.Option<Schema.Json>, CredentialError>;
  readonly put: (
    ref: InstallationRef,
    credential: Schema.Json,
  ) => Effect.Effect<void, CredentialError>;
}
export class InstallationCredentials extends Context.Service<InstallationCredentials, Interface>()(
  "@notus/platform/InstallationCredentials",
) {}

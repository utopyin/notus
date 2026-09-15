import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Platform } from "./platform";

export class InstallError extends Schema.TaggedError<InstallError>()("Sources.InstallError", {
  platform: Platform,
  /** `unconfigured`: this deployment cannot install the platform at all. */
  reason: Schema.Literals(["unconfigured", "rejected", "transport", "invalid-response"]),
}) {}

/** What the host knows and the adapter cannot: where to send the platform back, and the nonce to carry. */
export interface InstallIntent {
  readonly state: string;
  /** The host's own completion route for this platform. */
  readonly redirectUri: string;
}

/** What an installation is once the platform confirmed it. The credential is the adapter's own shape. */
export interface Installed {
  readonly installationId: string;
  readonly label: string;
  readonly credential: Schema.Json;
}

/**
 * The platform half of connecting an installation: send the administrator to the platform, and
 * turn what the platform sends back into an installation. Whether the workspace may install, and
 * every durable write, is the host's.
 */
export interface PlatformInstalling {
  readonly begin: (intent: InstallIntent) => Effect.Effect<{ readonly url: string }, InstallError>;
  /** Decodes the platform's redirect; the raw query never leaves the adapter. */
  readonly complete: (
    intent: InstallIntent,
    query: URLSearchParams,
  ) => Effect.Effect<Installed, InstallError>;
}

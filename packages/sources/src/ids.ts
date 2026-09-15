import * as Schema from "effect/Schema";
import { Platform } from "./platform";

/**
 * Where a platform was installed: a Slack team, a GitHub App installation. Opaque; meaningful only
 * as a `(Platform, InstallationId)` pair.
 */
export const InstallationId = Schema.NonEmptyString.pipe(Schema.brand("InstallationId"));
export type InstallationId = typeof InstallationId.Type;

/**
 * The platform-native identifier of a channel, repository, thread, message, comment or user. Only
 * the owning adapter may parse, normalize or construct one: core code that pulls one apart has
 * reached past the seam.
 */
export const PlatformId = Schema.NonEmptyString.pipe(Schema.brand("PlatformId"));
export type PlatformId = typeof PlatformId.Type;

/** Everything an adapter needs to act for one installation. */
export const InstallationRef = Schema.Struct({
  platform: Platform,
  installationId: InstallationId,
});
export interface InstallationRef extends Schema.Schema.Type<typeof InstallationRef> {}

/**
 * What a workspace may choose in its restricted devbox configuration, as plain values the policy
 * validates against. Free of Effect, so a browser bundle can import this file without the
 * provider client behind it.
 */

/** The only environment variables a workspace may set: locale, time and terminal hints. Loader, shell, runtime, proxy and model overrides are unsafe. */
export const environmentNames = [
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TERM",
  "COLORTERM",
  "NO_COLOR",
  "PROJECT_VARIANT",
] as const;
export type EnvironmentName = (typeof environmentNames)[number];

export const architectures = ["amd64", "arm64"] as const;
export type Architecture = (typeof architectures)[number];

/** An environment value: printable ASCII, at most this long. */
export const environmentValueLength = 256;
export const environmentValuePattern = /^[\x20-\x7e]*$/;

/** An immutable OCI reference: registry/repository@sha256:digest. */
export const imageRefPattern =
  /^[a-z0-9][a-z0-9.-]*(?::[0-9]+)?\/[a-z0-9]+(?:(?:[._-]|\/)[a-z0-9]+)*@sha256:[a-f0-9]{64}$/;

/** A protobuf duration: whole or fractional seconds with an "s" suffix. */
export const durationPattern = /^-?(0|[1-9][0-9]*)(\.[0-9]{1,9})?s$/;

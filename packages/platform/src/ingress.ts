import type * as Effect from "effect/Effect";
import type { IngressError } from "./errors";
import type { Received } from "./source";

/** The untouched request: adapters verify the raw bytes before reading anything. */
export interface IngressRequest {
  readonly body: Uint8Array;
  readonly header: (name: string) => string | null;
}

export type Normalized =
  /** The platform expects this body back, such as Slack's URL verification challenge. */
  | { readonly type: "acknowledge"; readonly body: unknown }
  | { readonly type: "ignored"; readonly reason: string }
  | { readonly type: "input"; readonly received: Received };

/** Verification, decoding and normalization in one step; the raw payload shape never leaves the adapter. */
export interface PlatformIngress {
  readonly receive: (request: IngressRequest) => Effect.Effect<Normalized, IngressError>;
}

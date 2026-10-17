import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import type * as Schema from "effect/Schema";
import type { ConnectionError } from "./errors";
import type { Provider } from "./provider";

/**
 * The provider account a workspace connected, as the adapter's own JSON. Host-trusted: only the
 * adapter reads it, and nothing that reads it projects it into a response, a log or a prompt.
 */
export interface Interface {
  readonly get: (
    workspaceId: string,
    provider: Provider,
  ) => Effect.Effect<Option.Option<Schema.Json>, ConnectionError>;
}
export class ComputeCredentials extends Context.Service<ComputeCredentials, Interface>()(
  "@notus/compute/Credentials",
) {}

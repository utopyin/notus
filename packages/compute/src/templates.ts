import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type { Provider } from "./provider";

/**
 * The template references a workspace's admins added for a provider. Host-trusted and carrying no
 * authorization: the adapter reads it to check that a launch selects one of them. A failed read
 * yields none, so a launch is refused rather than an unlisted template started.
 */
export interface Interface {
  readonly approved: (
    workspaceId: string,
    provider: Provider,
  ) => Effect.Effect<ReadonlyArray<string>>;
}
export class Templates extends Context.Service<Templates, Interface>()(
  "@notus/compute/Templates",
) {}

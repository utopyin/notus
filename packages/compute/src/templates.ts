import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type { Provider } from "./provider";

/** The template references a workspace's admins added for one provider, and the one they marked default. */
export interface TemplateSet {
  readonly refs: ReadonlyArray<string>;
  /** Null when no admin picked one; the adapter may still infer one. */
  readonly default: string | null;
}

/**
 * Host-trusted and carrying no authorization: the adapter reads it to check that a launch selects
 * one of the workspace's templates. A failed read yields none, so the launch is refused.
 */
export interface Interface {
  readonly approved: (workspaceId: string, provider: Provider) => Effect.Effect<TemplateSet>;
}
export class Templates extends Context.Service<Templates, Interface>()(
  "@notus/compute/Templates",
) {}

import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import type * as Redacted from "effect/Redacted";

export interface Interface {
  /** A Boat API key, `boat_…`. */
  readonly credential: Redacted.Redacted<string>;
  readonly timeoutMs: number;
}
export class Service extends Context.Service<Service, Interface>()("@notus/boat/Config") {}
export const layer = (settings: Interface) => Layer.succeed(Service, settings);
export const endpoint = "https://boat.dev/api/v1";
export * as Config from "./config";

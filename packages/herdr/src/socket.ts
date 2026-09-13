import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type { Failure } from "./errors";

export interface Interface {
  readonly exchange: (path: string, request: string) => Effect.Effect<string, Failure>;
}
export class Service extends Context.Service<Service, Interface>()("@notus/herdr/Socket") {}

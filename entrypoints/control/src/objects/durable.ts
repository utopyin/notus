import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

/**
 * The durable object hosting a service: its input gate, key-value storage and alarm. The app
 * implements it over its platform's object state; objects never see the platform type.
 */
export interface Interface {
  /**
   * Runs `effect` while the object holds every other event. Expected failures leave the gate as
   * values and are restored outside it, so they never reset the object.
   */
  readonly gate: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  readonly get: (key: string) => Effect.Effect<unknown>;
  readonly put: (key: string, value: unknown) => Effect.Effect<void>;
  readonly alarm: Effect.Effect<number | null>;
  readonly setAlarm: (at: number) => Effect.Effect<void>;
  readonly deleteAlarm: Effect.Effect<void>;
}

export class Service extends Context.Service<Service, Interface>()(
  "@notus/control/objects/Durable",
) {}

export * as Durable from "./durable";

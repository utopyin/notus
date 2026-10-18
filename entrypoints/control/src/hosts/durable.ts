import type { RuntimeContext } from "alchemy";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

/**
 * The Durable Object hosting a service: its input gate, key-value storage and alarm. The app
 * implements it over the platform's object state; hosts never see the platform type.
 */
export interface Interface {
  /**
   * Runs `effect` while the object holds every other event. Expected failures leave the gate as
   * values and are restored outside it, so they never reset the object.
   */
  readonly gate: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R | RuntimeContext>;
  readonly get: (key: string) => Effect.Effect<unknown, never, RuntimeContext>;
  readonly put: (key: string, value: unknown) => Effect.Effect<void, never, RuntimeContext>;
  readonly alarm: Effect.Effect<number | null, never, RuntimeContext>;
  readonly setAlarm: (at: number) => Effect.Effect<void, never, RuntimeContext>;
  readonly deleteAlarm: Effect.Effect<void, never, RuntimeContext>;
}

/**
 * Methods run inside an object or Worker handler, which supplies the runtime context.
 *
 * @effect-expect-leaking RuntimeContext
 */
export class Service extends Context.Service<Service, Interface>()(
  "@notus/control/hosts/Durable",
) {}

export * as Durable from "./durable";

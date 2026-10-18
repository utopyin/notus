import { Durable } from "@notus/control/objects/durable";
import * as Cloudflare from "alchemy/Cloudflare";
import { RuntimeContext } from "alchemy/RuntimeContext";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/**
 * The current object's gate, storage and alarm, from its platform state. Alchemy marks these
 * calls with `RuntimeContext` so they type-check only inside a handler; the port is only used
 * there, so the marker is erased with its phantom layer, as Alchemy's own adapters do.
 */
export const layer = Layer.effect(
  Durable.Service,
  Effect.map(Cloudflare.DurableObjectState, (state) =>
    Durable.Service.of({
      // A failure leaves the gate as a value, never a rejected promise that resets the object.
      gate: (effect) =>
        state
          .blockConcurrencyWhile(() => Effect.exit(effect))
          .pipe(Effect.flatten, Effect.provide(RuntimeContext.phantom)),
      get: (key) => state.storage.get(key).pipe(Effect.provide(RuntimeContext.phantom)),
      put: (key, value) =>
        state.storage.put(key, value).pipe(Effect.provide(RuntimeContext.phantom)),
      alarm: state.storage.getAlarm().pipe(Effect.provide(RuntimeContext.phantom)),
      setAlarm: (at) => state.storage.setAlarm(at).pipe(Effect.provide(RuntimeContext.phantom)),
      deleteAlarm: state.storage.deleteAlarm().pipe(Effect.provide(RuntimeContext.phantom)),
    }),
  ),
);

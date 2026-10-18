import { Durable } from "@notus/control/objects/durable";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/** The current object's gate, storage and alarm, from its platform state. */
export const layer = Layer.effect(
  Durable.Service,
  Effect.map(Cloudflare.DurableObjectState, (state) =>
    Durable.Service.of({
      // A failure leaves the gate as a value, never a rejected promise that resets the object.
      gate: (effect) => state.blockConcurrencyWhile(() => Effect.exit(effect)).pipe(Effect.flatten),
      get: (key) => state.storage.get(key),
      put: (key, value) => state.storage.put(key, value),
      alarm: state.storage.getAlarm(),
      setAlarm: (at) => state.storage.setAlarm(at),
      deleteAlarm: state.storage.deleteAlarm(),
    }),
  ),
);

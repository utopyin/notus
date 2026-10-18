import { Durable } from "@notus/control/objects/durable";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { within } from "./execution";

/** The current object's gate, storage and alarm, from its platform state. */
export const layer = Layer.effect(
  Durable.Service,
  Effect.map(Cloudflare.DurableObjectState, (state) =>
    Durable.Service.of({
      // A failure leaves the gate as a value, never a rejected promise that resets the object.
      gate: (effect) =>
        Effect.flatten(within(state.blockConcurrencyWhile(() => Effect.exit(effect)))),
      get: (key) => within(state.storage.get(key)),
      put: (key, value) => within(state.storage.put(key, value)),
      alarm: within(state.storage.getAlarm()),
      setAlarm: (at) => within(state.storage.setAlarm(at)),
      deleteAlarm: within(state.storage.deleteAlarm()),
    }),
  ),
);

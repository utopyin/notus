import { RuntimeContext } from "alchemy/RuntimeContext";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

/**
 * Runs a platform call in the current execution. Alchemy supplies the runtime context to every
 * handler and object call; the control plane's ports carry no platform type, so the adapters
 * here take it from the execution they are called in.
 */
export const within = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, RuntimeContext>> =>
  Effect.flatMap(Effect.serviceOption(RuntimeContext), (context) =>
    Option.isSome(context)
      ? Effect.provideService(effect, RuntimeContext, context.value)
      : Effect.die(new Error("A platform call ran outside a handler")),
  );

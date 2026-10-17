import { descriptorOf } from "@notus/compute/descriptors/index";
import type { Environment } from "@notus/workspaces/types";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { Commands } from "./commands";
import { Devbox } from "./devbox";
import type { ExecutionError, ProvisioningFailure } from "./errors";
import { Provisioning } from "./provisioning";
import type { Resource } from "./types";

// The hold outlasts two missed renewals, so one slow or failed alarm never stops a working box.
const leaseSeconds = 15 * 60;
const renewMs = 5 * 60_000;
const retryMs = 30_000;

/** A call to make on the provider, outside the task's gate. */
export interface Due {
  readonly environment: Environment;
  readonly resource: Resource;
  /** Null hands the box back to its configured idle stop. */
  readonly seconds: number | null;
}

/**
 * Keeps a working box from being stopped by its provider's own deadline, for providers that
 * declare `activity:lease`. The box works while it holds a claimed runtime command. The hold is
 * renewed by the task's alarm and handed back once the command ends.
 *
 * What is held lives in memory only. An evicted object forgets it: a running command is held
 * again on the next alarm, and a box whose hand-back was forgotten stops when its last hold runs
 * out. Either way the provider's deadline, never Notus, is what finally stops a box.
 */
export interface Interface {
  /** What the alarm should do now, if anything. Reads local state only. */
  readonly due: (now: number) => Effect.Effect<Due | null, ExecutionError | ProvisioningFailure>;
  /** When `due` next has something to do. */
  readonly nextWake: (
    now: number,
  ) => Effect.Effect<number | null, ExecutionError | ProvisioningFailure>;
  /** Makes the call; a failure is retried after a short wait, never in a tight loop. */
  readonly perform: (due: Due, now: number) => Effect.Effect<void>;
}
export class Service extends Context.Service<Service, Interface>()("@notus/executions/Activity") {}

interface Held {
  readonly resourceId: string;
  readonly renewAt: number;
}

export const layerNoDeps = Layer.effect(
  Service,
  Effect.gen(function* () {
    const commands = yield* Commands.Service;
    const provisioning = yield* Provisioning.Service;
    const devbox = yield* Devbox.Service;
    const held = yield* Ref.make<Held | null>(null);
    const retryAt = yield* Ref.make(0);

    const observe = Effect.gen(function* () {
      const box = yield* provisioning.box;
      if (box === null) return null;
      if (!descriptorOf(box.environment.provider)?.capabilities.has("activity:lease")) return null;
      const working = (yield* commands.snapshot).some(
        (row) => row.executor === "runtime" && row.status === "claimed",
      );
      return { ...box, working };
    });
    const plan = Effect.fn("Activity.plan")(function* (now: number) {
      const box = yield* observe;
      const stored = yield* Ref.get(held);
      // A held box that is gone, blocked or replaced is left to its own deadline.
      const current = box !== null && stored?.resourceId === box.resource.id ? stored : null;
      if (current !== stored) yield* Ref.set(held, null);
      if (box === null) return null;
      if (box.working) {
        const at = current === null ? now : current.renewAt;
        return { at, due: { ...box, seconds: leaseSeconds } };
      }
      return current === null ? null : { at: now, due: { ...box, seconds: null } };
    });

    return Service.of({
      due: Effect.fn("Activity.due")(function* (now) {
        const next = yield* plan(now);
        if (next === null || next.at > now || (yield* Ref.get(retryAt)) > now) return null;
        return {
          environment: next.due.environment,
          resource: next.due.resource,
          seconds: next.due.seconds,
        };
      }),
      nextWake: Effect.fn("Activity.nextWake")(function* (now) {
        const next = yield* plan(now);
        return next === null ? null : Math.max(next.at, yield* Ref.get(retryAt));
      }),
      perform: Effect.fn("Activity.perform")(function* (due, now) {
        const ok = yield* devbox.hold(due.environment, due.resource, due.seconds).pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        );
        if (!ok) return yield* Ref.set(retryAt, now + retryMs);
        yield* Ref.set(retryAt, 0);
        yield* Ref.set(
          held,
          due.seconds === null ? null : { resourceId: due.resource.id, renewAt: now + renewMs },
        );
        yield* Effect.logInfo(
          `devbox.activity ${due.seconds === null ? "released" : `held ${due.seconds}s`}`,
        );
      }),
    });
  }),
);
export const layer = layerNoDeps;
export * as Activity from "./activity";

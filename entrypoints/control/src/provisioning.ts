import { key, type Admission } from "@notus/contracts/source";
import { Provisioning } from "@notus/executions/provisioning";
import { digest, type ProvisioningStatus } from "@notus/executions/types";
import { State } from "@notus/tasks/state";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";

const summary = (status: ProvisioningStatus): string => {
  const last =
    status.lastReadyAt === null
      ? "Herdr readiness has not been confirmed."
      : `Herdr readiness was last observed at ${DateTime.formatIso(DateTime.makeUnsafe(status.lastReadyAt))}.`;
  const lifecycle =
    status.phase === "ready"
      ? "The devbox remains assigned. Namespace last reported it running; it may auto-sleep."
      : status.phase === "blocked"
        ? `Provisioning is blocked: ${status.blockedReason ?? "unknown"}. ${status.resourceId ? "The devbox assignment is retained." : "No devbox assignment has been confirmed."} No replacement will be created automatically.`
        : "Devbox startup or wake-up is still in progress.";
  const wake = status.resourceId ? " Reply with wake to request wake-up of this same box." : "";
  return `${lifecycle} ${last} No model or repository work was run.${wake}`;
};

/** Readiness admission deliberately does not create a simulated invocation. */
export const admit = Effect.fn("ProvisioningControl.admit")(function* (command: Admission) {
  const state = yield* State.Service;
  return yield* state.admit(command);
});

/** Local-only repair. The host performs provider calls outside its concurrency gate. */
export const advance = Effect.fn("ProvisioningControl.advance")(function* (now: number) {
  const state = yield* State.Service;
  const execution = yield* Provisioning.Service;
  const task = yield* state.snapshot;
  if (!task.task || task.task.mode !== "readiness") return 0;
  let status = yield* execution.current;
  // The durable D1 forwarding handoff supplies the environment before acknowledgement.
  if (!status) return 0;
  const reservation = task.task.reservation;
  const origin = task.inputs.find((row) => row.id === reservation.startInputId);
  const responded = new Set(task.responses.map((row) => row.inputId));
  let count = 0;
  for (const row of task.inputs) {
    if (count >= 16) break;
    if (responded.has(row.id)) continue;
    const initial = row.id === reservation.startInputId;
    const wake = !initial && row.input.text.trim().toLowerCase() === "wake";
    const authorized = origin !== undefined && Equal.equals(origin.input.actor, row.input.actor);
    if (wake && authorized) {
      yield* execution.requestWake(row.id, now);
      status = (yield* execution.current) ?? status;
    }
    if (
      (initial || (wake && authorized)) &&
      (status.pendingWork !== null || (status.phase !== "ready" && status.phase !== "blocked"))
    )
      continue;
    const text = `${wake && !authorized ? "Only the initiating actor may wake the box in this readiness slice. " : ""}${summary(status)}`;
    yield* state.recordResponse(
      {
        id: key("runtime-status", row.id),
        inputId: row.id,
        content: text,
        digest: digest(text),
        acceptedAt: now,
      },
      now,
    );
    count++;
  }
  return count;
});

export const nextWake = Effect.fn("ProvisioningControl.nextWake")(function* (now: number) {
  const state = yield* State.Service;
  const execution = yield* Provisioning.Service;
  const task = yield* state.snapshot;
  const status = yield* execution.current;
  if (!task.task || !status) return yield* state.nextWake(now);
  const responded = new Set(task.responses.map((row) => row.inputId));
  const origin = task.inputs.find((row) => row.id === task.task?.reservation.startInputId);
  const final =
    status.pendingWork === null && (status.phase === "ready" || status.phase === "blocked");
  const unanswered = task.inputs.some((row) => {
    if (responded.has(row.id)) return false;
    if (row.id === task.task?.reservation.startInputId) return final;
    const wake =
      row.input.text.trim().toLowerCase() === "wake" &&
      origin !== undefined &&
      Equal.equals(origin.input.actor, row.input.actor);
    // A wake without provider work needs a pass to schedule its durable intent.
    return !wake || final;
  });
  if (unanswered) return now;
  const times = [yield* state.nextWake(now), yield* execution.nextWake].filter(
    (value): value is number => value !== null,
  );
  return times.length ? Math.max(now, Math.min(...times)) : null;
});

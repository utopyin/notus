import { Sqlite } from "@notus/cloudflare/sqlite";
import { Admission, Source, key } from "@notus/sources/source";
import { digest } from "@notus/executions/types";
import { and, asc, eq, lte, or, sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { Conflict, NotInitialized, StaleClaim, StorageFailure, type TaskError } from "./errors";
import {
  DeliveryRow,
  EventRow,
  InputRow,
  ResponseRow,
  SourceRow,
  TaskRow,
  deliveries,
  events,
  inputs,
  responses,
  sources,
  tasks,
} from "./schema";
import {
  AdmissionReceipt,
  DeliveryClaim,
  DeliveryOutcome,
  Millis,
  Settings,
  ResponseInput,
  Handoff,
} from "./types";

const batchSize = 16;
export class Configuration extends Context.Service<Configuration, Settings>()(
  "@notus/tasks/State.Configuration",
) {}
export const configuration = (settings: Settings) =>
  Layer.effect(Configuration, Schema.decodeEffect(Settings)(settings));

export const Snapshot = Schema.Struct({
  task: Schema.NullOr(TaskRow),
  sources: Schema.Array(SourceRow),
  inputs: Schema.Array(InputRow),
  events: Schema.Array(EventRow),
  responses: Schema.Array(ResponseRow),
  deliveries: Schema.Array(DeliveryRow),
});
export interface Snapshot extends Schema.Schema.Type<typeof Snapshot> {}

export interface Interface {
  readonly admit: (command: Admission) => Effect.Effect<AdmissionReceipt, TaskError>;
  /** Records a non-origin source, idempotently. It receives inputs and replies; it never takes updates. */
  readonly attach: (source: Source, now: number) => Effect.Effect<string, TaskError>;
  readonly missingHandoffs: (
    scheduledInputIds: ReadonlyArray<string>,
    limit: number,
  ) => Effect.Effect<ReadonlyArray<Handoff>, TaskError>;
  readonly missingResponses: (
    resultIds: ReadonlyArray<string>,
    limit: number,
  ) => Effect.Effect<ReadonlyArray<string>, TaskError>;
  readonly recordResponse: (
    response: ResponseInput,
    now: number,
  ) => Effect.Effect<string, TaskError>;
  readonly claimDueDelivery: (now: number) => Effect.Effect<DeliveryClaim | null, TaskError>;
  readonly recordDeliveryOutcome: (
    claim: DeliveryClaim,
    outcome: DeliveryOutcome,
    now: number,
  ) => Effect.Effect<void, TaskError>;
  readonly nextWake: (now: number) => Effect.Effect<number | null, TaskError>;
  readonly snapshot: Effect.Effect<Snapshot, TaskError>;
}
export class Service extends Context.Service<Service, Interface>()("@notus/tasks/State") {}

export const layerNoDeps = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = yield* Sqlite.Service;
    const settings = yield* Schema.decodeEffect(Settings)(yield* Configuration);
    const crypto = yield* Crypto.Crypto;

    // Only local synchronous Effects may enter this callback: Drizzle uses transactionSync.
    const atomic = <A, E>(operation: string, run: (tx: Sqlite.Queries) => Effect.Effect<A, E>) =>
      db
        .transaction((tx) => run(tx))
        .pipe(
          Effect.mapError((error): TaskError => {
            if (
              Schema.is(Conflict)(error) ||
              Schema.is(NotInitialized)(error) ||
              Schema.is(StaleClaim)(error) ||
              Schema.isSchemaError(error)
            )
              return error;
            return new StorageFailure({ operation, cause: error });
          }),
        );

    const recordWithin = Effect.fn("State.recordWithin")(function* (
      tx: Sqlite.Queries,
      outcome: ResponseInput,
      now: number,
    ) {
      const [input] = yield* tx.select().from(inputs).where(eq(inputs.id, outcome.inputId));
      if (!input)
        return yield* new Conflict({ message: "Outcome input is not admitted to this task" });
      const responseId = key("response", outcome.id);
      const [existing] = yield* tx
        .select()
        .from(responses)
        .where(eq(responses.resultId, outcome.id));
      if (
        existing &&
        (existing.inputId !== input.id || existing.text !== outcome.content || !existing.final)
      ) {
        return yield* new Conflict({ message: "Accepted result has a conflicting response" });
      }
      if (!existing)
        yield* tx.insert(responses).values({
          id: responseId,
          inputId: input.id,
          resultId: outcome.id,
          text: outcome.content,
          final: true,
          createdAt: outcome.acceptedAt,
        });
      // Replay also repairs a missing outbox row without running the simulator again.
      yield* tx
        .insert(deliveries)
        .values({
          id: key("answer", outcome.id),
          inputId: input.id,
          responseId: existing?.id ?? responseId,
          kind: "answer",
          text: outcome.content,
          digest: outcome.digest,
          status: "pending",
          retryAt: now,
        })
        .onConflictDoNothing();
      return existing?.id ?? responseId;
    });

    const admit = Effect.fn("State.admit")(function* (command: Admission) {
      const { reservation, input } = yield* Schema.decodeEffect(Admission)(command);
      const now = DateTime.toEpochMillis(yield* DateTime.now);
      return yield* atomic(
        "admit",
        Effect.fnUntraced(function* (tx) {
          if (
            reservation.workspaceId !== input.workspaceId ||
            reservation.conversationKey !== input.conversationKey ||
            !Equal.equals(reservation.source, input.target.source) ||
            input.actor.installationId !== reservation.source.installationId ||
            input.actor.platform !== reservation.source.platform
          ) {
            return yield* new Conflict({
              message: "Input and reservation disagree about workspace or source",
            });
          }
          const [stored] = yield* tx.select().from(tasks).limit(1);
          let sourceId: string;
          if (!stored) {
            if (input.inputId !== reservation.startInputId)
              return yield* new NotInitialized({ taskId: reservation.taskId });
            if (!input.startIntent || input.occurredAt !== reservation.startAt) {
              return yield* new Conflict({
                message: "Initiating input does not match the reservation",
              });
            }
            sourceId = key("origin", reservation.taskId);
            yield* tx.insert(tasks).values({
              singleton: 1,
              id: reservation.taskId,
              reservation,
              // Deployment policy applies only when this task is first initialized.
              mode: settings.mode ?? "simulation",
              originSourceId: sourceId,
              createdAt: now,
            });
            yield* tx.insert(sources).values({
              id: sourceId,
              taskId: reservation.taskId,
              attachment: {
                id: sourceId,
                source: reservation.source,
                origin: true,
                receive: true,
                reaction: true,
                reply: true,
                updates: true,
              },
            });
          } else {
            const task = yield* Schema.decodeEffect(TaskRow)(stored);
            if (task.id !== reservation.taskId || task.closedAt !== null) {
              return yield* new Conflict({
                message: "Task reservation, owner, and origin are immutable",
              });
            }
            if (Equal.equals(task.reservation, reservation)) {
              sourceId = task.originSourceId;
            } else {
              // An attached source routes through its own conversation but never changes the owner.
              const attachedId = key(
                "attached",
                reservation.source.platform,
                reservation.source.installationId,
                reservation.source.scope,
                reservation.source.conversation,
              );
              const [attached] = yield* tx.select().from(sources).where(eq(sources.id, attachedId));
              if (
                !attached ||
                input.startIntent ||
                reservation.initiatorId !== task.reservation.initiatorId ||
                reservation.workspaceId !== task.reservation.workspaceId
              ) {
                return yield* new Conflict({
                  message: "Input source is not attached to this task",
                });
              }
              sourceId = attachedId;
            }
          }
          const eventKey = key(reservation.source.installationId, input.eventId);
          const [event] = yield* tx.select().from(events).where(eq(events.id, eventKey));
          if (event && event.inputId !== input.inputId)
            return yield* new Conflict({ message: "Event ID reused for another input" });
          const matches = yield* tx
            .select()
            .from(inputs)
            .where(or(eq(inputs.id, input.inputId), eq(inputs.messageKey, input.messageKey)));
          const existing = matches[0];
          if (existing) {
            const saved = yield* Schema.decodeEffect(InputRow)(existing);
            const { eventId: _savedEvent, startIntent: savedStart, ...savedPayload } = saved.input;
            const { eventId: _event, startIntent, ...payload } = input;
            if (matches.length !== 1 || !Equal.equals(savedPayload, payload)) {
              return yield* new Conflict({
                message: "Input ID or message key reused with different content",
              });
            }
            if (startIntent && !savedStart)
              yield* tx
                .update(inputs)
                .set({ input: { ...saved.input, startIntent: true } })
                .where(eq(inputs.id, existing.id));
          } else {
            yield* tx.insert(inputs).values({
              id: input.inputId,
              messageKey: input.messageKey,
              sourceId,
              input,
              obligation: "pending",
              createdAt: now,
            });
            yield* tx.insert(deliveries).values({
              id: key("reaction", input.inputId),
              inputId: input.inputId,
              kind: "reaction",
              text: null,
              digest: digest("eyes"),
              status: "pending",
              retryAt: now,
            });
          }
          if (!event) yield* tx.insert(events).values({ id: eventKey, inputId: input.inputId });
          return {
            taskId: reservation.taskId,
            inputId: input.inputId,
            duplicate: existing !== undefined,
          };
        }),
      );
    });

    const attach = Effect.fn("State.attach")(function* (value: Source, now: number) {
      const source = yield* Schema.decodeEffect(Source)(value);
      yield* Schema.decodeEffect(Millis)(now);
      return yield* atomic(
        "attach",
        Effect.fnUntraced(function* (tx) {
          const [stored] = yield* tx.select().from(tasks).limit(1);
          if (!stored) return yield* new NotInitialized({ taskId: "unknown" });
          const task = yield* Schema.decodeEffect(TaskRow)(stored);
          if (task.closedAt !== null) return yield* new Conflict({ message: "Task is closed" });
          if (Equal.equals(task.reservation.source, source)) return task.originSourceId;
          const id = key(
            "attached",
            source.platform,
            source.installationId,
            source.scope,
            source.conversation,
          );
          yield* tx
            .insert(sources)
            .values({
              id,
              taskId: task.id,
              attachment: {
                id,
                source,
                origin: false,
                receive: true,
                reaction: true,
                reply: true,
                updates: false,
              },
            })
            .onConflictDoNothing();
          return id;
        }),
      );
    });

    const missingHandoffs = Effect.fn("State.missingHandoffs")(function* (
      scheduledInputIds: ReadonlyArray<string>,
      limit: number,
    ) {
      return yield* atomic(
        "missingHandoffs",
        Effect.fnUntraced(function* (tx) {
          const scheduled = new Set(scheduledInputIds);
          const rows = yield* tx
            .select({ id: inputs.id, createdAt: inputs.createdAt })
            .from(inputs)
            .orderBy(asc(inputs.createdAt), asc(inputs.id));
          const missing = rows.filter((row) => !scheduled.has(row.id)).slice(0, limit);
          if (missing.length === 0) return [];
          const [task] = yield* tx.select().from(tasks).limit(1);
          if (!task) return yield* new Conflict({ message: "Input exists without a task" });
          return missing.map((input) => ({
            taskId: task.id,
            inputId: input.id,
            createdAt: input.createdAt,
          }));
        }),
      );
    });
    const missingResponses = Effect.fn("State.missingResponses")(function* (
      resultIds: ReadonlyArray<string>,
      limit: number,
    ) {
      return yield* atomic(
        "missingResponses",
        Effect.fnUntraced(function* (tx) {
          const complete = yield* tx
            .select({ id: responses.resultId })
            .from(responses)
            .innerJoin(deliveries, eq(deliveries.responseId, responses.id));
          const recorded = new Set(complete.map((row) => row.id));
          return resultIds.filter((id) => !recorded.has(id)).slice(0, limit);
        }),
      );
    });
    const recordResponse = Effect.fn("State.recordResponse")(function* (
      command: ResponseInput,
      now: number,
    ) {
      const response = yield* Schema.decodeEffect(ResponseInput)(command);
      yield* Schema.decodeEffect(Millis)(now);
      return yield* atomic("recordResponse", (tx) => recordWithin(tx, response, now));
    });

    const claimDueDelivery = Effect.fn("State.claimDueDelivery")(function* (now: number) {
      yield* Schema.decodeEffect(Millis)(now);
      return yield* atomic(
        "claimDueDelivery",
        Effect.fnUntraced(function* (tx) {
          const expired = yield* tx
            .select()
            .from(deliveries)
            .where(and(eq(deliveries.status, "sending"), lte(deliveries.recoverAt, now)))
            .orderBy(asc(deliveries.recoverAt), asc(deliveries.id))
            .limit(batchSize);
          for (const delivery of expired) {
            yield* tx
              .update(deliveries)
              .set(
                delivery.kind === "answer"
                  ? { status: "ambiguous", failure: "claim_expired", recoverAt: null }
                  : { status: "pending", retryAt: now, recoverAt: null, failure: "claim_expired" },
              )
              .where(eq(deliveries.id, delivery.id));
          }
          const due = yield* tx
            .select()
            .from(deliveries)
            .where(and(eq(deliveries.status, "pending"), lte(deliveries.retryAt, now)))
            .orderBy(
              asc(deliveries.retryAt),
              sql`case when ${deliveries.kind} = 'reaction' then 0 else 1 end`,
              asc(deliveries.id),
            )
            .limit(batchSize);
          for (const raw of due) {
            const delivery = yield* Schema.decodeEffect(DeliveryRow)(raw);
            const [rawInput] = yield* tx
              .select()
              .from(inputs)
              .where(eq(inputs.id, delivery.inputId));
            if (!rawInput) return yield* new Conflict({ message: "Delivery has no input" });
            const input = yield* Schema.decodeEffect(InputRow)(rawInput);
            if (delivery.kind === "reaction" && input.obligation === "fulfilled") {
              yield* tx
                .update(deliveries)
                .set({ status: "skipped" })
                .where(eq(deliveries.id, delivery.id));
              continue;
            }
            const claimId = yield* crypto.randomUUIDv4;
            const generation = delivery.generation + 1;
            const recoverAt = now + settings.claimTtlMs;
            const claim = yield* Schema.decodeEffect(DeliveryClaim)({
              deliveryId: delivery.id,
              inputId: input.id,
              sourceId: input.sourceId,
              target: input.input.target,
              kind: delivery.kind,
              text: delivery.text,
              reaction: delivery.kind === "reaction" ? "eyes" : null,
              digest: delivery.digest,
              claimId,
              generation,
              recoverAt,
            });
            yield* tx
              .update(deliveries)
              .set({
                status: "sending",
                claimId,
                generation,
                recoverAt,
                outcome: null,
                failure: null,
              })
              .where(eq(deliveries.id, delivery.id));
            return claim;
          }
          return null;
        }),
      );
    });

    const recordDeliveryOutcome = Effect.fn("State.recordDeliveryOutcome")(function* (
      rawClaim: DeliveryClaim,
      rawOutcome: DeliveryOutcome,
      now: number,
    ) {
      const claim = yield* Schema.decodeEffect(DeliveryClaim)(rawClaim);
      const outcome = yield* Schema.decodeEffect(DeliveryOutcome)(rawOutcome);
      yield* Schema.decodeEffect(Millis)(now);
      return yield* atomic(
        "recordDeliveryOutcome",
        Effect.fnUntraced(function* (tx) {
          const [raw] = yield* tx
            .select()
            .from(deliveries)
            .where(eq(deliveries.id, claim.deliveryId));
          if (!raw) return yield* new StaleClaim({ deliveryId: claim.deliveryId });
          const delivery = yield* Schema.decodeEffect(DeliveryRow)(raw);
          if (
            delivery.claimId !== claim.claimId ||
            delivery.generation !== claim.generation ||
            delivery.inputId !== claim.inputId ||
            delivery.kind !== claim.kind ||
            delivery.digest !== claim.digest
          ) {
            return yield* new StaleClaim({ deliveryId: claim.deliveryId });
          }
          const [rawInput] = yield* tx.select().from(inputs).where(eq(inputs.id, delivery.inputId));
          if (!rawInput) return yield* new Conflict({ message: "Delivery has no input" });
          const input = yield* Schema.decodeEffect(InputRow)(rawInput);
          if (
            claim.sourceId !== input.sourceId ||
            !Equal.equals(claim.target, input.input.target) ||
            claim.text !== delivery.text ||
            claim.reaction !== (delivery.kind === "reaction" ? "eyes" : null)
          ) {
            return yield* new Conflict({
              message: "Claim payload differs from its persisted delivery",
            });
          }
          if (delivery.outcome !== null) {
            if (Equal.equals(delivery.outcome, outcome)) return;
            return yield* new Conflict({ message: "Delivery claim already has another outcome" });
          }
          if (
            delivery.status !== "sending" ||
            delivery.recoverAt === null ||
            delivery.recoverAt <= now ||
            delivery.recoverAt !== claim.recoverAt
          ) {
            return yield* new StaleClaim({ deliveryId: claim.deliveryId });
          }
          switch (outcome._tag) {
            case "Confirmed":
              yield* tx
                .update(deliveries)
                .set({ status: "confirmed", receipt: outcome.receipt, recoverAt: null, outcome })
                .where(eq(deliveries.id, delivery.id));
              if (delivery.kind === "answer") {
                yield* tx
                  .update(inputs)
                  .set({ obligation: "fulfilled", fulfilledAt: now })
                  .where(eq(inputs.id, delivery.inputId));
                yield* tx
                  .update(deliveries)
                  .set({ status: "skipped" })
                  .where(
                    and(
                      eq(deliveries.inputId, delivery.inputId),
                      eq(deliveries.kind, "reaction"),
                      eq(deliveries.status, "pending"),
                    ),
                  );
              }
              break;
            case "RateLimited":
              // A delay while reacquiring the gate does not make a known non-send ambiguous.
              // Keep the original receipt; schedule an elapsed provider deadline immediately.
              yield* tx
                .update(deliveries)
                .set({
                  status:
                    delivery.kind === "reaction" && input.obligation === "fulfilled"
                      ? "skipped"
                      : "pending",
                  retryAt: Math.max(now + 1, outcome.retryAt),
                  recoverAt: null,
                  outcome,
                  failure: "rate_limited",
                })
                .where(eq(deliveries.id, delivery.id));
              break;
            case "Rejected":
              yield* tx
                .update(deliveries)
                .set({ status: "rejected", recoverAt: null, outcome, failure: outcome.code })
                .where(eq(deliveries.id, delivery.id));
              break;
            case "Ambiguous":
              yield* tx
                .update(deliveries)
                .set(
                  delivery.kind === "reaction"
                    ? {
                        status: input.obligation === "fulfilled" ? "skipped" : "pending",
                        retryAt: now + settings.claimTtlMs,
                        recoverAt: null,
                        outcome,
                        failure: outcome.code,
                      }
                    : { status: "ambiguous", recoverAt: null, outcome, failure: outcome.code },
                )
                .where(eq(deliveries.id, delivery.id));
              break;
          }
        }),
      );
    });

    const nextWake = Effect.fn("State.nextWake")(function* (now: number) {
      yield* Schema.decodeEffect(Millis)(now);
      return yield* atomic(
        "nextWake",
        Effect.fnUntraced(function* (tx) {
          const [pending] = yield* tx
            .select({ at: deliveries.retryAt })
            .from(deliveries)
            .where(eq(deliveries.status, "pending"))
            .orderBy(asc(deliveries.retryAt))
            .limit(1);
          const [sending] = yield* tx
            .select({ at: deliveries.recoverAt })
            .from(deliveries)
            .where(eq(deliveries.status, "sending"))
            .orderBy(asc(deliveries.recoverAt))
            .limit(1);
          const times = [pending?.at, sending?.at].filter(
            (at): at is number => at !== null && at !== undefined,
          );
          return times.length === 0 ? null : Math.max(now, Math.min(...times));
        }),
      );
    });

    const snapshot = atomic(
      "snapshot",
      Effect.fnUntraced(function* (tx) {
        const [task] = yield* tx.select().from(tasks).limit(1);
        return yield* Schema.decodeEffect(Snapshot)({
          task: task ?? null,
          sources: yield* tx.select().from(sources),
          inputs: yield* tx.select().from(inputs),
          events: yield* tx.select().from(events),
          responses: yield* tx.select().from(responses),
          deliveries: yield* tx.select().from(deliveries),
        });
      }),
    ).pipe(Effect.withSpan("State.snapshot"));
    return Service.of({
      admit,
      attach,
      missingHandoffs,
      missingResponses,
      recordResponse,
      claimDueDelivery,
      recordDeliveryOutcome,
      nextWake,
      snapshot,
    });
  }),
);
export const layer = layerNoDeps;
export * as State from "./state";

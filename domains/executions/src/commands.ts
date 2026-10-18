import { Sqlite } from "@notus/cloudflare/sqlite";
import { and, asc, eq, lte, ne, or } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { Conflict, StorageFailure, type ExecutionError } from "./errors";
import { CommandRow, attempts, commands, polls } from "./schema";
import { Command, CommandObservation, CommandSpec, Millis, executorOf } from "./types";

// A control-plane action lease; expiry re-offers the action to the next alarm.
const controlLeaseMs = 60_000;

export const Poll = Schema.Struct({ epoch: Millis, polledAt: Millis });
export interface Poll extends Schema.Schema.Type<typeof Poll> {}

const within = (db: Sqlite.Queries, crypto: Crypto.Crypto) => {
  const enqueue = Effect.fn("Commands.enqueue")(function* (
    stepId: string,
    callId: string,
    input: CommandSpec,
    now: number,
  ) {
    yield* Schema.decodeEffect(Schema.NonEmptyString)(stepId);
    yield* Schema.decodeEffect(Schema.NonEmptyString)(callId);
    const spec = yield* Schema.decodeEffect(CommandSpec)(input);

    yield* Schema.decodeEffect(Millis)(now);

    const [existing] = yield* db
      .select()
      .from(commands)
      .where(and(eq(commands.stepId, stepId), eq(commands.callId, callId)));

    if (existing) return yield* Schema.decodeEffect(CommandRow)(existing);

    const [attempt] = yield* db.select().from(attempts).where(eq(attempts.active, true));
    if (!attempt) return yield* new Conflict({ message: "No active attempt for command" });

    const row = {
      id: yield* crypto.randomUUIDv4(),
      attemptId: attempt.id,
      generation: attempt.generation,
      stepId,
      callId,
      spec,
      executor: executorOf(spec),
      status: "pending" as const,
      claimEpoch: null,
      claimedAt: null,
      result: null,
      failure: null,
      createdAt: now,
      updatedAt: now,
    };

    yield* db.insert(commands).values(row);

    return yield* Schema.decodeEffect(CommandRow)(row);
  });
  /** A newer runtime epoch proves the old process is gone; its claimed commands cannot report. */
  const claim = Effect.fn("Commands.claim")(function* (epoch: number, now: number) {
    yield* Schema.decodeEffect(Millis)(epoch);
    yield* Schema.decodeEffect(Millis)(now);

    yield* db
      .insert(polls)
      .values({ singleton: 1, epoch, polledAt: now })
      .onConflictDoUpdate({ target: polls.singleton, set: { epoch, polledAt: now } });

    yield* db
      .update(commands)
      .set({ status: "failed", failure: "runtime-restarted", updatedAt: now })
      .where(and(eq(commands.status, "claimed"), ne(commands.claimEpoch, epoch)));

    const [attempt] = yield* db.select().from(attempts).where(eq(attempts.active, true));
    if (!attempt) return null;

    const [row] = yield* db
      .select()
      .from(commands)
      .where(
        and(
          eq(commands.status, "pending"),
          eq(commands.executor, "runtime"),
          eq(commands.attemptId, attempt.id),
          eq(commands.generation, attempt.generation),
        ),
      )
      .orderBy(asc(commands.createdAt), asc(commands.id))
      .limit(1);
    if (!row) return null;

    const command = yield* Schema.decodeEffect(CommandRow)(row);

    yield* db
      .update(commands)
      .set({ status: "claimed", claimEpoch: epoch, claimedAt: now, updatedAt: now })
      .where(eq(commands.id, command.id));

    return Command.make({ id: command.id, spec: command.spec });
  });
  /** Control-plane actions are leased to one alarm pass at a time; the lease is the fence. */
  const claimControl = Effect.fn("Commands.claimControl")(function* (now: number) {
    yield* Schema.decodeEffect(Millis)(now);
    const [attempt] = yield* db.select().from(attempts).where(eq(attempts.active, true));
    if (!attempt) return null;

    const [row] = yield* db
      .select()
      .from(commands)
      .where(
        and(
          eq(commands.executor, "control"),
          eq(commands.attemptId, attempt.id),
          eq(commands.generation, attempt.generation),
          or(
            eq(commands.status, "pending"),
            and(eq(commands.status, "claimed"), lte(commands.claimedAt, now - controlLeaseMs)),
          ),
        ),
      )
      .orderBy(asc(commands.createdAt), asc(commands.id))
      .limit(1);
    if (!row) return null;

    const command = yield* Schema.decodeEffect(CommandRow)(row);

    yield* db
      .update(commands)
      .set({ status: "claimed", claimEpoch: null, claimedAt: now, updatedAt: now })
      .where(eq(commands.id, command.id));

    return Command.make({ id: command.id, spec: command.spec });
  });
  const complete = Effect.fn("Commands.complete")(function* (
    id: string,
    claimedAt: number,
    result: CommandObservation["result"],
    now: number,
  ) {
    yield* Schema.decodeEffect(Schema.NonEmptyString)(id);
    yield* Schema.decodeEffect(Millis)(now);
    const [row] = yield* db.select().from(commands).where(eq(commands.id, id));
    if (!row) return yield* new Conflict({ message: "Unknown command" });

    const command = yield* Schema.decodeEffect(CommandRow)(row);

    if (command.status === "done") return;

    if (command.status !== "claimed" || command.claimedAt !== claimedAt)
      return yield* new Conflict({ message: "Stale control action lease" });

    yield* db
      .update(commands)
      .set({ status: "done", result, updatedAt: now })
      .where(eq(commands.id, id));
  });
  const observe = Effect.fn("Commands.observe")(function* (
    input: CommandObservation,
    epoch: number,
    now: number,
  ) {
    const observation = yield* Schema.decodeEffect(CommandObservation)(input);

    yield* Schema.decodeEffect(Millis)(epoch);
    yield* Schema.decodeEffect(Millis)(now);
    const [row] = yield* db.select().from(commands).where(eq(commands.id, observation.commandId));
    if (!row) return yield* new Conflict({ message: "Unknown command" });

    const command = yield* Schema.decodeEffect(CommandRow)(row);

    if (command.status === "done") {
      if (!Equal.equals(command.result, observation.result))
        return yield* new Conflict({ message: "Conflicting command observation" });

      return command;
    }

    if (command.status !== "claimed" || command.claimEpoch !== epoch)
      return yield* new Conflict({ message: "Observation does not match the claimed runtime" });

    yield* db
      .update(commands)
      .set({ status: "done", result: observation.result, updatedAt: now })
      .where(eq(commands.id, command.id));

    return yield* Schema.decodeEffect(CommandRow)({
      ...row,
      status: "done",
      result: observation.result,
      updatedAt: now,
    });
  });
  const fail = Effect.fn("Commands.fail")(function* (id: string, failure: string, now: number) {
    yield* Schema.decodeEffect(Schema.NonEmptyString)(id);
    yield* Schema.decodeEffect(Millis)(now);

    yield* db
      .update(commands)
      .set({ status: "failed", failure, updatedAt: now })
      .where(
        and(
          eq(commands.id, id),
          or(eq(commands.status, "pending"), eq(commands.status, "claimed")),
        ),
      );
  });
  /**
   * After a replacement, open commands of an earlier attempt: those for its box fail, since that
   * box is gone, and control actions move to the active attempt with their claim untouched, so a
   * lease still running completes and a lost one is offered again as before. Idempotent.
   */
  const reassign = Effect.fn("Commands.reassign")(function* (now: number) {
    yield* Schema.decodeEffect(Millis)(now);

    const [attempt] = yield* db.select().from(attempts).where(eq(attempts.active, true));
    if (!attempt) return;

    const open = or(eq(commands.status, "pending"), eq(commands.status, "claimed"));
    const stale = ne(commands.attemptId, attempt.id);

    yield* db
      .update(commands)
      .set({ status: "failed", failure: "the dev box was replaced", updatedAt: now })
      .where(and(stale, open, eq(commands.executor, "runtime")));

    yield* db
      .update(commands)
      .set({ attemptId: attempt.id, generation: attempt.generation, updatedAt: now })
      .where(and(stale, open, eq(commands.executor, "control")));
  });
  const ofStep = Effect.fn("Commands.ofStep")(function* (stepId: string) {
    return yield* Schema.decodeEffect(Schema.Array(CommandRow))(
      yield* db.select().from(commands).where(eq(commands.stepId, stepId)),
    );
  });

  const lastPoll = Effect.gen(function* () {
    const [row] = yield* db.select().from(polls).where(eq(polls.singleton, 1));
    return row ? Poll.make({ epoch: row.epoch, polledAt: row.polledAt }) : null;
  }).pipe(Effect.withSpan("Commands.lastPoll"));
  const snapshot = Effect.gen(function* () {
    return yield* Schema.decodeEffect(Schema.Array(CommandRow))(
      yield* db.select().from(commands).orderBy(asc(commands.createdAt)),
    );
  }).pipe(Effect.withSpan("Commands.snapshot"));

  return {
    enqueue,
    claim,
    claimControl,
    complete,
    observe,
    fail,
    reassign,
    ofStep,
    lastPoll,
    snapshot,
  };
};

/**
 * Commands are pulled by the enrolled runtime under its epoch and answered once. A poll from a
 * newer epoch fails every command the older runtime still held; nothing is re-run automatically.
 */
export interface Interface {
  readonly enqueue: (
    stepId: string,
    callId: string,
    spec: CommandSpec,
    now: number,
  ) => Effect.Effect<CommandRow, ExecutionError>;
  readonly claim: (epoch: number, now: number) => Effect.Effect<Command | null, ExecutionError>;
  readonly claimControl: (now: number) => Effect.Effect<Command | null, ExecutionError>;
  readonly complete: (
    id: string,
    claimedAt: number,
    result: CommandObservation["result"],
    now: number,
  ) => Effect.Effect<void, ExecutionError>;
  readonly observe: (
    observation: CommandObservation,
    epoch: number,
    now: number,
  ) => Effect.Effect<CommandRow, ExecutionError>;
  readonly fail: (id: string, failure: string, now: number) => Effect.Effect<void, ExecutionError>;
  readonly reassign: (now: number) => Effect.Effect<void, ExecutionError>;
  readonly ofStep: (stepId: string) => Effect.Effect<ReadonlyArray<CommandRow>, ExecutionError>;
  readonly lastPoll: Effect.Effect<Poll | null, ExecutionError>;
  readonly snapshot: Effect.Effect<ReadonlyArray<CommandRow>, ExecutionError>;
}
export class Service extends Context.Service<Service, Interface>()("@notus/executions/Commands") {}
export const layerNoDeps = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = yield* Sqlite.Service;
    const crypto = yield* Crypto.Crypto;
    const queries = (tx: Sqlite.Queries) => within(tx, crypto);

    const wrap = <A, E>(operation: string, effect: Effect.Effect<A, E>) =>
      effect.pipe(
        Effect.mapError((cause): ExecutionError => {
          if (Schema.is(Conflict)(cause) || Schema.isSchemaError(cause)) return cause;
          return new StorageFailure({ operation, cause });
        }),
      );

    return Service.of({
      enqueue: Effect.fn("Commands.enqueueAtomic")((stepId, callId, spec, now) =>
        wrap(
          "enqueue",
          db.transaction((tx) => queries(tx).enqueue(stepId, callId, spec, now)),
        ),
      ),
      claim: Effect.fn("Commands.claimAtomic")((epoch, now) =>
        wrap(
          "claim",
          db.transaction((tx) => queries(tx).claim(epoch, now)),
        ),
      ),
      reassign: Effect.fn("Commands.reassignAtomic")((now) =>
        wrap(
          "reassign",
          db.transaction((tx) => queries(tx).reassign(now)),
        ),
      ),
      claimControl: Effect.fn("Commands.claimControlAtomic")((now) =>
        wrap(
          "claimControl",
          db.transaction((tx) => queries(tx).claimControl(now)),
        ),
      ),
      complete: Effect.fn("Commands.completeAtomic")((id, claimedAt, result, now) =>
        wrap(
          "complete",
          db.transaction((tx) => queries(tx).complete(id, claimedAt, result, now)),
        ),
      ),
      observe: Effect.fn("Commands.observeAtomic")((observation, epoch, now) =>
        wrap(
          "observe",
          db.transaction((tx) => queries(tx).observe(observation, epoch, now)),
        ),
      ),
      fail: Effect.fn("Commands.failAtomic")((id, failure, now) =>
        wrap(
          "fail",
          db.transaction((tx) => queries(tx).fail(id, failure, now)),
        ),
      ),
      ofStep: Effect.fn("Commands.ofStepAtomic")((stepId) =>
        wrap(
          "ofStep",
          db.transaction((tx) => queries(tx).ofStep(stepId)),
        ),
      ),
      lastPoll: wrap(
        "lastPoll",
        db.transaction((tx) => queries(tx).lastPoll),
      ).pipe(Effect.withSpan("Commands.lastPollAtomic")),
      snapshot: wrap(
        "snapshot",
        db.transaction((tx) => queries(tx).snapshot),
      ).pipe(Effect.withSpan("Commands.snapshotAtomic")),
    });
  }),
);
export const layer = layerNoDeps;
export * as Commands from "./commands";

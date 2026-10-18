import { Sqlite } from "@notus/cloudflare/sqlite";
import { and, asc, eq, lte, or } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { Conflict, StaleAttempt, StorageFailure, type ExecutionError } from "./errors";
import { Attempt, Invocation, Outcome, attempts, invocations, outcomes } from "./schema";
import { Millis, Mode, Observation, digest } from "./types";

/** Execution-owned transactions contain no external effects. */
const within = (db: Sqlite.Queries, crypto: Crypto.Crypto) => {
  const ensure = Effect.fn("Attempts.ensure")(function* (taskId: string, now: number, mode: Mode) {
    yield* Schema.decodeEffect(Schema.NonEmptyString)(taskId);
    yield* Schema.decodeEffect(Millis)(now);
    yield* Schema.decodeEffect(Mode)(mode);

    const [row] = yield* db
      .select()
      .from(attempts)
      .where(and(eq(attempts.taskId, taskId), eq(attempts.active, true)));

    if (row) {
      const active = yield* Schema.decodeEffect(Attempt)(row);
      // The persisted attempt mode is immutable; a deployment default never rewrites it.
      if (active.mode !== mode) return yield* new Conflict({ message: "Attempt mode mismatch" });
      return active;
    }

    const attempt: Attempt = {
      id: yield* crypto.randomUUIDv4(),
      taskId,
      generation: 1,
      mode,
      active: true,
      createdAt: now,
    };

    yield* db.insert(attempts).values(attempt);

    return attempt;
  });

  /**
   * A new generation takes over from the active operator attempt, carrying its turns still in
   * flight, so they settle on it. The replaced attempt keeps its history and loses its authority.
   */
  const replace = Effect.fn("Attempts.replace")(function* (taskId: string, now: number) {
    yield* Schema.decodeEffect(Schema.NonEmptyString)(taskId);
    yield* Schema.decodeEffect(Millis)(now);

    const [row] = yield* db
      .select()
      .from(attempts)
      .where(and(eq(attempts.taskId, taskId), eq(attempts.active, true)));

    if (!row) return yield* new Conflict({ message: "No active attempt to replace" });

    const previous = yield* Schema.decodeEffect(Attempt)(row);

    if (previous.mode !== "operator")
      return yield* new Conflict({ message: "Only operator attempts are replaced" });

    const current: Attempt = {
      id: yield* crypto.randomUUIDv4(),
      taskId,
      generation: previous.generation + 1,
      mode: previous.mode,
      active: true,
      createdAt: now,
    };

    yield* db.update(attempts).set({ active: false }).where(eq(attempts.id, previous.id));
    yield* db.insert(attempts).values(current);

    yield* db
      .update(invocations)
      .set({ attemptId: current.id, generation: current.generation })
      .where(and(eq(invocations.attemptId, previous.id), eq(invocations.status, "pending")));

    return { previous, current };
  });

  const schedule = Effect.fn("Attempts.schedule")(function* (
    attempt: Attempt,
    inputId: string,
    dueAt: number,
    content: string,
  ) {
    yield* Schema.decodeEffect(Schema.String)(content);
    yield* Schema.decodeEffect(Schema.NonEmptyString)(inputId);
    yield* Schema.decodeEffect(Millis)(dueAt);

    const [active] = yield* db
      .select()
      .from(attempts)
      .where(and(eq(attempts.id, attempt.id), eq(attempts.active, true)));

    if (!active || active.generation !== attempt.generation || active.taskId !== attempt.taskId) {
      return yield* new StaleAttempt({ attemptId: attempt.id });
    }

    const [existing] = yield* db.select().from(invocations).where(eq(invocations.inputId, inputId));

    if (existing) {
      if (existing.attemptId !== attempt.id || existing.generation !== attempt.generation) {
        return yield* new Conflict({ message: "Input already belongs to another invocation" });
      }

      // An admission replay must not move the original deadline or rewrite the payload.
      return yield* Schema.decodeEffect(Invocation)(existing);
    }

    const invocation: Invocation = {
      id: yield* crypto.randomUUIDv4(),
      attemptId: attempt.id,
      generation: attempt.generation,
      inputId,
      operationId: yield* crypto.randomUUIDv4(),
      dueAt,
      version: 1,
      resultId: yield* crypto.randomUUIDv4(),
      content,
      digest: digest(content),
      status: "pending",
    };

    yield* db.insert(invocations).values(invocation);

    return invocation;
  });

  const accept = Effect.fn("Attempts.accept")(function* (command: Observation, now: number) {
    const observation = yield* Schema.decodeEffect(Observation)(command);

    yield* Schema.decodeEffect(Millis)(now);

    const [attempt] = yield* db
      .select()
      .from(attempts)
      .where(eq(attempts.id, observation.attemptId));

    if (!attempt || !attempt.active || attempt.generation !== observation.generation) {
      return yield* new StaleAttempt({ attemptId: observation.attemptId });
    }

    const [invocation] = yield* db
      .select()
      .from(invocations)
      .where(eq(invocations.id, observation.invocationId));

    if (
      !invocation ||
      invocation.attemptId !== observation.attemptId ||
      invocation.generation !== observation.generation ||
      invocation.inputId !== observation.inputId ||
      invocation.operationId !== observation.operationId ||
      observation.digest !== digest(observation.content)
    ) {
      return yield* new Conflict({ message: "Outcome does not match its invocation" });
    }

    // Simulation mode cannot be used to inject arbitrary remote-generated content.
    if (
      attempt.mode === "simulation" &&
      (now < invocation.dueAt ||
        observation.resultId !== invocation.resultId ||
        observation.content !== invocation.content ||
        observation.digest !== invocation.digest)
    ) {
      return yield* new Conflict({
        message: "Outcome differs from the persisted simulation result or is premature",
      });
    }

    const existing = yield* db
      .select()
      .from(outcomes)
      .where(
        or(
          eq(outcomes.id, observation.resultId),
          eq(outcomes.invocationId, observation.invocationId),
        ),
      );

    if (existing.length > 0) {
      const row = existing[0];

      if (!row || existing.length !== 1 || !Equal.equals(row.observation, observation)) {
        return yield* new Conflict({ message: "Conflicting outcome replay" });
      }

      return yield* Schema.decodeEffect(Outcome)(row);
    }

    const outcome: Outcome = {
      id: observation.resultId,
      invocationId: observation.invocationId,
      observation,
      acceptedAt: now,
    };

    yield* db.insert(outcomes).values(outcome);

    yield* db
      .update(invocations)
      .set({ status: "accepted" })
      .where(eq(invocations.id, invocation.id));

    return outcome;
  });

  const scheduledInputIds = Effect.gen(function* () {
    return (yield* db.select({ id: invocations.inputId }).from(invocations)).map((row) => row.id);
  }).pipe(Effect.withSpan("Attempts.scheduledInputIds"));
  const accepted = Effect.gen(function* () {
    return yield* Schema.decodeEffect(Schema.Array(Outcome))(
      yield* db.select().from(outcomes).orderBy(asc(outcomes.acceptedAt), asc(outcomes.id)),
    );
  }).pipe(Effect.withSpan("Attempts.accepted"));

  const due = Effect.fn("Attempts.due")(function* (now: number, limit: number) {
    yield* Schema.decodeEffect(Millis)(now);

    return yield* Schema.decodeEffect(Schema.Array(Invocation))(
      yield* db
        .select()
        .from(invocations)
        .where(and(eq(invocations.status, "pending"), lte(invocations.dueAt, now)))
        .orderBy(asc(invocations.dueAt), asc(invocations.id))
        .limit(limit),
    );
  });

  const nextWake = Effect.gen(function* () {
    const [row] = yield* db
      .select({ at: invocations.dueAt })
      .from(invocations)
      .where(eq(invocations.status, "pending"))
      .orderBy(asc(invocations.dueAt))
      .limit(1);

    return row?.at ?? null;
  }).pipe(Effect.withSpan("Attempts.nextWake"));
  const snapshot = Effect.gen(function* () {
    return {
      attempts: yield* Schema.decodeEffect(Schema.Array(Attempt))(
        yield* db.select().from(attempts),
      ),
      invocations: yield* Schema.decodeEffect(Schema.Array(Invocation))(
        yield* db.select().from(invocations),
      ),
      outcomes: yield* accepted,
    };
  }).pipe(Effect.withSpan("Attempts.snapshot"));

  return {
    ensure,
    replace,
    schedule,
    accept,
    scheduledInputIds,
    accepted,
    due,
    nextWake,
    snapshot,
  };
};

export interface Interface {
  readonly ensure: (
    taskId: string,
    now: number,
    mode: Mode,
  ) => Effect.Effect<Attempt, ExecutionError>;
  readonly replace: (
    taskId: string,
    now: number,
  ) => Effect.Effect<{ readonly previous: Attempt; readonly current: Attempt }, ExecutionError>;
  readonly schedule: (
    attempt: Attempt,
    inputId: string,
    dueAt: number,
    content: string,
  ) => Effect.Effect<Invocation, ExecutionError>;
  readonly accept: (
    observation: Observation,
    now: number,
  ) => Effect.Effect<Outcome, ExecutionError>;
  readonly scheduledInputIds: Effect.Effect<ReadonlyArray<string>, ExecutionError>;
  readonly accepted: Effect.Effect<ReadonlyArray<Outcome>, ExecutionError>;
  readonly due: (
    now: number,
    limit: number,
  ) => Effect.Effect<ReadonlyArray<Invocation>, ExecutionError>;
  readonly nextWake: Effect.Effect<number | null, ExecutionError>;
  readonly snapshot: Effect.Effect<
    {
      readonly attempts: ReadonlyArray<Attempt>;
      readonly invocations: ReadonlyArray<Invocation>;
      readonly outcomes: ReadonlyArray<Outcome>;
    },
    ExecutionError
  >;
}
export class Service extends Context.Service<Service, Interface>()("@notus/executions/Attempts") {}
export const layerNoDeps = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = yield* Sqlite.Service;
    const crypto = yield* Crypto.Crypto;
    const queries = (tx: Sqlite.Queries) => within(tx, crypto);

    // Every service operation owns its transaction; Control repairs cross-owner handoffs.
    const wrap = <A, E>(operation: string, effect: Effect.Effect<A, E>) =>
      effect.pipe(
        Effect.mapError((cause): ExecutionError => {
          if (
            Schema.is(Conflict)(cause) ||
            Schema.is(StaleAttempt)(cause) ||
            Schema.isSchemaError(cause)
          )
            return cause;

          return new StorageFailure({ operation, cause });
        }),
      );

    return Service.of({
      ensure: Effect.fn("Attempts.ensureAtomic")((taskId, now, mode) =>
        wrap(
          "ensure",
          db.transaction((tx) => queries(tx).ensure(taskId, now, mode)),
        ),
      ),
      replace: Effect.fn("Attempts.replaceAtomic")((taskId, now) =>
        wrap(
          "replace",
          db.transaction((tx) => queries(tx).replace(taskId, now)),
        ),
      ),
      schedule: Effect.fn("Attempts.scheduleAtomic")((attempt, inputId, dueAt, content) =>
        wrap(
          "schedule",
          db.transaction((tx) => queries(tx).schedule(attempt, inputId, dueAt, content)),
        ),
      ),
      scheduledInputIds: wrap(
        "scheduledInputIds",
        db.transaction((tx) => queries(tx).scheduledInputIds),
      ).pipe(Effect.withSpan("Attempts.scheduledInputIdsAtomic")),
      accepted: wrap(
        "accepted",
        db.transaction((tx) => queries(tx).accepted),
      ).pipe(Effect.withSpan("Attempts.acceptedAtomic")),
      due: Effect.fn("Attempts.dueAtomic")((now, limit) =>
        wrap(
          "due",
          db.transaction((tx) => queries(tx).due(now, limit)),
        ),
      ),
      nextWake: wrap(
        "nextWake",
        db.transaction((tx) => queries(tx).nextWake),
      ).pipe(Effect.withSpan("Attempts.nextWakeAtomic")),
      snapshot: wrap(
        "snapshot",
        db.transaction((tx) => queries(tx).snapshot),
      ).pipe(Effect.withSpan("Attempts.snapshotAtomic")),
      accept: Effect.fn("Attempts.acceptAtomic")((observation, now) =>
        wrap(
          "accept",
          db.transaction((tx) => queries(tx).accept(observation, now)),
        ),
      ),
    });
  }),
);
export const layer = layerNoDeps;
export * as Attempts from "./attempts";

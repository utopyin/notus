import { Sqlite } from "@notus/cloudflare/sqlite";
import { and, asc, eq, lte, or } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { Conflict, StorageFailure, type ExecutionError } from "./errors";
import { Step, invocations, steps } from "./schema";
import { Millis } from "./types";

// Operational bounds. The lease exceeds one bounded provider call. The step bound is a runaway
// guard, not a usage limit: product policy imposes no execution cap, and real editing work
// takes many rounds.
const leaseMs = 150_000;
const maxAttempts = 6;
const maxSteps = 200;

export const StepClaim = Schema.Struct({
  id: Schema.NonEmptyString,
  invocationId: Schema.NonEmptyString,
  index: Millis,
  operationId: Schema.NonEmptyString,
  attempts: Schema.Int.check(Schema.isGreaterThan(0)),
  recoverAt: Millis,
  /** Encoded response parts of this invocation's completed steps, in order. */
  priorParts: Schema.Array(Schema.Json),
});
export interface StepClaim extends Schema.Schema.Type<typeof StepClaim> {}
export const PendingCall = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  params: Schema.Json,
});
export interface PendingCall extends Schema.Schema.Type<typeof PendingCall> {}
export const StepOutcome = Schema.TaggedUnion({
  Completed: {
    parts: Schema.Json,
    text: Schema.String,
    calls: Schema.Array(PendingCall),
    final: Schema.Boolean,
  },
  Retry: { retryAt: Millis, failure: Schema.NonEmptyString },
  Failed: { failure: Schema.NonEmptyString },
});
export type StepOutcome = typeof StepOutcome.Type;
export const Waiting = Schema.Struct({
  id: Schema.NonEmptyString,
  invocationId: Schema.NonEmptyString,
  calls: Schema.Array(PendingCall),
  createdAt: Millis,
});
export interface Waiting extends Schema.Schema.Type<typeof Waiting> {}
export const Settled = Schema.Struct({
  invocationId: Schema.NonEmptyString,
  /** Every step of the turn, so its commands can be told apart from earlier turns'. */
  stepIds: Schema.Array(Schema.NonEmptyString),
  result: Schema.TaggedUnion({
    Final: { text: Schema.String },
    Failed: { failure: Schema.NonEmptyString },
  }),
});
export interface Settled extends Schema.Schema.Type<typeof Settled> {}

const within = (db: Sqlite.Queries, crypto: Crypto.Crypto) => {
  const insert = Effect.fn("Steps.insert")(function* (
    invocationId: string,
    index: number,
    now: number,
    status: "pending" | "failed",
    failure: string | null,
  ) {
    yield* db.insert(steps).values({
      id: yield* crypto.randomUUIDv4(),
      invocationId,
      index,
      operationId: yield* crypto.randomUUIDv4(),
      status,
      attempts: 0,
      dueAt: now,
      recoverAt: null,
      parts: null,
      text: null,
      calls: null,
      final: false,
      failure,
      createdAt: now,
      updatedAt: now,
    });
  });
  const ensure = Effect.fn("Steps.ensure")(function* (invocationId: string, now: number) {
    yield* Schema.decodeEffect(Schema.NonEmptyString)(invocationId);
    yield* Schema.decodeEffect(Millis)(now);

    const [invocation] = yield* db
      .select({ id: invocations.id })
      .from(invocations)
      .where(eq(invocations.id, invocationId));
    if (!invocation) return yield* new Conflict({ message: "Unknown invocation" });

    const [existing] = yield* db
      .select({ id: steps.id })
      .from(steps)
      .where(eq(steps.invocationId, invocationId))
      .limit(1);

    if (!existing) yield* insert(invocationId, 0, now, "pending", null);
  });
  const claim = Effect.fn("Steps.claim")(function* (now: number) {
    yield* Schema.decodeEffect(Millis)(now);

    const [row] = yield* db
      .select()
      .from(steps)
      .where(
        or(
          and(eq(steps.status, "pending"), lte(steps.dueAt, now)),
          and(eq(steps.status, "running"), lte(steps.recoverAt, now)),
        ),
      )
      .orderBy(asc(steps.dueAt), asc(steps.createdAt))
      .limit(1);
    if (!row) return null;

    const step = yield* Schema.decodeEffect(Step)(row);
    const attempts = step.attempts + 1;
    const recoverAt = now + leaseMs;

    yield* db
      .update(steps)
      .set({ status: "running", attempts, recoverAt, updatedAt: now })
      .where(eq(steps.id, step.id));

    const prior = yield* db
      .select()
      .from(steps)
      .where(and(eq(steps.invocationId, step.invocationId), eq(steps.status, "done")))
      .orderBy(asc(steps.index));

    const priorParts: Array<Schema.Json> = [];

    for (const earlier of prior) {
      const decoded = yield* Schema.decodeEffect(Step)(earlier);
      if (decoded.index < step.index && decoded.parts !== null) priorParts.push(decoded.parts);
    }

    return StepClaim.make({
      id: step.id,
      invocationId: step.invocationId,
      index: step.index,
      operationId: step.operationId,
      attempts,
      recoverAt,
      priorParts,
    });
  });
  const record = Effect.fn("Steps.record")(function* (
    input: StepClaim,
    output: StepOutcome,
    now: number,
  ) {
    const claimed = yield* Schema.decodeEffect(StepClaim)(input);
    const outcome = yield* Schema.decodeEffect(StepOutcome)(output);

    yield* Schema.decodeEffect(Millis)(now);
    const [row] = yield* db.select().from(steps).where(eq(steps.id, claimed.id));
    if (!row) return yield* new Conflict({ message: "Unknown step" });

    const step = yield* Schema.decodeEffect(Step)(row);

    // A lease that expired and was re-claimed belongs to the later claimant.
    if (
      step.status !== "running" ||
      step.attempts !== claimed.attempts ||
      step.recoverAt !== claimed.recoverAt
    )
      return yield* new Conflict({ message: "Stale step claim" });

    switch (outcome._tag) {
      case "Completed": {
        if (outcome.calls.length > 0) {
          // The owner executes these durably and resolves the step; no next step yet.
          yield* db
            .update(steps)
            .set({
              status: "waiting",
              parts: outcome.parts,
              text: outcome.text,
              calls: outcome.calls,
              final: false,
              recoverAt: null,
              updatedAt: now,
            })
            .where(eq(steps.id, step.id));

          return;
        }

        yield* db
          .update(steps)
          .set({
            status: "done",
            parts: outcome.parts,
            text: outcome.text,
            final: outcome.final,
            recoverAt: null,
            updatedAt: now,
          })
          .where(eq(steps.id, step.id));

        if (!outcome.final) {
          if (step.index + 1 >= maxSteps)
            yield* insert(step.invocationId, step.index + 1, now, "failed", "step-limit");
          else yield* insert(step.invocationId, step.index + 1, now, "pending", null);
        }

        return;
      }
      case "Retry": {
        if (claimed.attempts >= maxAttempts) {
          yield* db
            .update(steps)
            .set({ status: "failed", failure: outcome.failure, recoverAt: null, updatedAt: now })
            .where(eq(steps.id, step.id));

          return;
        }

        yield* db
          .update(steps)
          .set({
            status: "pending",
            dueAt: Math.max(now, outcome.retryAt),
            failure: outcome.failure,
            recoverAt: null,
            updatedAt: now,
          })
          .where(eq(steps.id, step.id));

        return;
      }
      case "Failed": {
        yield* db
          .update(steps)
          .set({ status: "failed", failure: outcome.failure, recoverAt: null, updatedAt: now })
          .where(eq(steps.id, step.id));

        return;
      }
    }
  });
  const waiting = Effect.fn("Steps.waiting")(function* (limit: number) {
    const rows = yield* db
      .select()
      .from(steps)
      .where(eq(steps.status, "waiting"))
      .orderBy(asc(steps.updatedAt), asc(steps.id))
      .limit(limit);

    const result: Array<Waiting> = [];

    for (const row of rows) {
      const step = yield* Schema.decodeEffect(Step)(row);
      const calls = yield* Schema.decodeUnknownEffect(Schema.Array(PendingCall))(step.calls ?? []);
      result.push({
        id: step.id,
        invocationId: step.invocationId,
        calls,
        createdAt: step.createdAt,
      });
    }

    return result;
  });
  /** Appends tool results to a waiting step and opens the next round. */
  const resolve = Effect.fn("Steps.resolve")(function* (
    id: string,
    results: ReadonlyArray<Schema.Json>,
    now: number,
  ) {
    yield* Schema.decodeEffect(Schema.NonEmptyString)(id);
    yield* Schema.decodeEffect(Millis)(now);
    const [row] = yield* db.select().from(steps).where(eq(steps.id, id));
    if (!row) return yield* new Conflict({ message: "Unknown step" });

    const step = yield* Schema.decodeEffect(Step)(row);

    if (step.status !== "waiting") return yield* new Conflict({ message: "Step is not waiting" });

    const prior = Array.isArray(step.parts) ? step.parts : [];
    yield* db
      .update(steps)
      .set({ status: "done", parts: [...prior, ...results], calls: null, updatedAt: now })
      .where(eq(steps.id, id));

    if (step.index + 1 >= maxSteps)
      yield* insert(step.invocationId, step.index + 1, now, "failed", "step-limit");
    else yield* insert(step.invocationId, step.index + 1, now, "pending", null);
  });
  /** Invocations whose latest step is a final answer or a failure. */
  const settled = Effect.fn("Steps.settled")(function* (limit: number) {
    const rows = yield* db
      .select()
      .from(steps)
      .where(or(and(eq(steps.status, "done"), eq(steps.final, true)), eq(steps.status, "failed")))
      .orderBy(asc(steps.updatedAt), asc(steps.id))
      .limit(limit);

    const result: Array<Settled> = [];

    for (const row of rows) {
      const step = yield* Schema.decodeEffect(Step)(row);

      const siblings = yield* db
        .select({ id: steps.id })
        .from(steps)
        .where(eq(steps.invocationId, step.invocationId));

      result.push({
        invocationId: step.invocationId,
        stepIds: siblings.map((sibling) => sibling.id),
        result:
          step.status === "failed"
            ? { _tag: "Failed", failure: step.failure ?? "unknown" }
            : { _tag: "Final", text: step.text ?? "" },
      });
    }

    return result;
  });

  const nextWake = Effect.gen(function* () {
    const [pending] = yield* db
      .select({ at: steps.dueAt })
      .from(steps)
      .where(eq(steps.status, "pending"))
      .orderBy(asc(steps.dueAt))
      .limit(1);
    const [running] = yield* db
      .select({ at: steps.recoverAt })
      .from(steps)
      .where(eq(steps.status, "running"))
      .orderBy(asc(steps.recoverAt))
      .limit(1);

    const times = [pending?.at, running?.at].filter(
      (at): at is number => at !== null && at !== undefined,
    );

    return times.length ? Math.min(...times) : null;
  }).pipe(Effect.withSpan("Steps.nextWake"));
  const snapshot = Effect.gen(function* () {
    return yield* Schema.decodeEffect(Schema.Array(Step))(
      yield* db.select().from(steps).orderBy(asc(steps.createdAt), asc(steps.index)),
    );
  }).pipe(Effect.withSpan("Steps.snapshot"));

  return { ensure, claim, record, waiting, resolve, settled, nextWake, snapshot };
};

/** Steps are sequential per invocation; a lease expiring re-offers the same step. */
export interface Interface {
  readonly ensure: (invocationId: string, now: number) => Effect.Effect<void, ExecutionError>;
  readonly claim: (now: number) => Effect.Effect<StepClaim | null, ExecutionError>;
  readonly record: (
    claim: StepClaim,
    outcome: StepOutcome,
    now: number,
  ) => Effect.Effect<void, ExecutionError>;
  readonly waiting: (limit: number) => Effect.Effect<ReadonlyArray<Waiting>, ExecutionError>;
  readonly resolve: (
    id: string,
    results: ReadonlyArray<Schema.Json>,
    now: number,
  ) => Effect.Effect<void, ExecutionError>;
  readonly settled: (limit: number) => Effect.Effect<ReadonlyArray<Settled>, ExecutionError>;
  readonly nextWake: Effect.Effect<number | null, ExecutionError>;
  readonly snapshot: Effect.Effect<ReadonlyArray<Step>, ExecutionError>;
}
export class Service extends Context.Service<Service, Interface>()("@notus/executions/Steps") {}
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
      ensure: Effect.fn("Steps.ensureAtomic")((invocationId, now) =>
        wrap(
          "ensure",
          db.transaction((tx) => queries(tx).ensure(invocationId, now)),
        ),
      ),
      claim: Effect.fn("Steps.claimAtomic")((now) =>
        wrap(
          "claim",
          db.transaction((tx) => queries(tx).claim(now)),
        ),
      ),
      record: Effect.fn("Steps.recordAtomic")((claim, outcome, now) =>
        wrap(
          "record",
          db.transaction((tx) => queries(tx).record(claim, outcome, now)),
        ),
      ),
      waiting: Effect.fn("Steps.waitingAtomic")((limit) =>
        wrap(
          "waiting",
          db.transaction((tx) => queries(tx).waiting(limit)),
        ),
      ),
      resolve: Effect.fn("Steps.resolveAtomic")((id, results, now) =>
        wrap(
          "resolve",
          db.transaction((tx) => queries(tx).resolve(id, results, now)),
        ),
      ),
      settled: Effect.fn("Steps.settledAtomic")((limit) =>
        wrap(
          "settled",
          db.transaction((tx) => queries(tx).settled(limit)),
        ),
      ),
      nextWake: wrap(
        "nextWake",
        db.transaction((tx) => queries(tx).nextWake),
      ).pipe(Effect.withSpan("Steps.nextWakeAtomic")),
      snapshot: wrap(
        "snapshot",
        db.transaction((tx) => queries(tx).snapshot),
      ).pipe(Effect.withSpan("Steps.snapshotAtomic")),
    });
  }),
);
export const layer = layerNoDeps;
export * as Steps from "./steps";

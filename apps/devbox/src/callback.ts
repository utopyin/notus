import { RuntimeClient } from "@notus/control/runtime/client";
import * as Protocol from "@notus/control/runtime/protocol";
import type { CommandResult } from "@notus/executions/types";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Journal from "./journal";
import { Failure, Settings } from "./settings";

/** How long after a command the box keeps long-polling before backing off. */
const activeWindowMs = 3 * 60_000;
/** Idle checks start this far apart and double up to the cap; the cap stays under control's 60 s stale threshold. */
const idleIntervalMs = 5_000;
const idleIntervalMaxMs = 45_000;

export interface Interface {
  readonly bound: boolean;
  readonly enroll: Effect.Effect<void, Failure>;
  readonly ready: <E, R>(
    validate: Effect.Effect<void, E, R>,
  ) => Effect.Effect<void, Failure | E, R>;
  /** Pull commands until the credential can no longer be refreshed or the host rejects it. */
  readonly commands: <R>(
    execute: (command: Protocol.RuntimeCommand) => Effect.Effect<CommandResult, never, R>,
  ) => Effect.Effect<never, Failure, R>;
}
export class Service extends Context.Service<Service, Interface>()("@notus/devbox/Callback") {}
export class Configuration extends Context.Service<
  Configuration,
  {
    readonly controlUrl: string;
    readonly bootstrap: Redacted.Redacted<string>;
  }
>()("@notus/devbox/Callback.Configuration") {}

// No overall wake deadline. Each HTTP request has its own bounded lifetime.
const backoff = Schedule.exponential("250 millis").pipe(
  Schedule.modifyDelay(({ duration }) =>
    Effect.succeed(Duration.min(duration, Duration.seconds(30))),
  ),
  Schedule.jittered,
);
const retry = <A>(effect: Effect.Effect<A, RuntimeClient.Failure>) =>
  effect.pipe(Effect.retry({ schedule: backoff, while: (failure) => failure.retryable }));

export const layerNoDeps = Layer.effect(
  Service,
  Effect.gen(function* () {
    const client = yield* RuntimeClient.Service;
    const config = yield* Configuration;
    const settings = yield* Settings.Service;
    const fs = yield* FileSystem.FileSystem;
    const crypto = yield* Crypto.Crypto;
    const open = Journal.open().pipe(
      Effect.provideService(Settings.Service, settings),
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Crypto.Crypto, crypto),
    );
    const read = Effect.fn("Devbox.Callback.read")(function* () {
      const store = yield* open;
      const journal = yield* store.read;
      if (journal !== null && journal.controlUrl !== config.controlUrl)
        return yield* new Failure({ reason: "binding" });
      return { store, journal };
    });
    const enroll = Effect.gen(function* () {
      const loaded = yield* read();
      const store = loaded.store;
      let journal: Journal.Journal = loaded.journal ?? {
        version: 1,
        controlUrl: config.controlUrl,
        credential: config.bootstrap,
        pending: null,
      };
      if (loaded.journal === null) yield* store.write(journal);
      if (journal.pending !== null) {
        let pending = journal.pending;
        // A free owner directory does not prove the previous process never launched.
        if (pending.request.kernelBootId === settings.kernelBootId)
          return yield* new Failure({ reason: "binding" });
        if (pending.reply === null) {
          const credential = journal.credential;
          const request = pending.request;
          const recover = Effect.gen(function* () {
            const assignment = yield* client.assignment(credential).pipe(
              // The client exposes permanent HTTP rejection, not a status code.
              // A consumed revision can only recover through exact enrollment replay.
              Effect.catchIf(
                (failure) => failure.reason === "rejected" && !failure.retryable,
                () => Effect.succeed(null),
              ),
            );
            if (assignment !== null) {
              if (assignment.resourceId !== request.resourceId)
                return yield* new Failure({ reason: "binding" });
              // Assignment authenticates the EXACT current recovery revision. A new
              // instance fences even an old enrollment still doing provider I/O.
              if (assignment.instanceId !== request.instanceId) return null;
            }
            return yield* client.enroll(credential, request);
          });
          const reply = yield* recover.pipe(
            Effect.retry({
              schedule: backoff,
              while: (failure) => failure._tag === "Runtime.CallbackFailure" && failure.retryable,
            }),
          );
          pending = { ...pending, reply };
          // Persist a recovered successor before retiring the old pending request.
          if (reply !== null) {
            journal = { ...journal, pending };
            yield* store.write(journal);
          }
        }
        journal = {
          ...journal,
          credential: pending.reply?.recoveryCredential ?? journal.credential,
          pending: null,
        };
        yield* store.write(journal);
      }
      const assignment = yield* retry(client.assignment(journal.credential));
      const request = yield* Schema.decodeEffect(Protocol.EnrollmentRequest)({
        resourceId: assignment.resourceId,
        instanceId: assignment.instanceId,
        requestId: yield* crypto.randomUUIDv4,
        runId: yield* crypto.randomUUIDv4,
        kernelBootId: settings.kernelBootId,
      });
      const observationId = yield* Schema.decodeEffect(
        Protocol.ReadinessRequest.fields.observationId,
      )(yield* crypto.randomUUIDv4);
      const pending = { request, observationId, reply: null, acknowledgment: null };
      journal = { ...journal, pending };
      yield* store.write(journal);
      const reply = yield* retry(client.enroll(journal.credential, request));
      yield* store.write({ ...journal, pending: { ...pending, reply } });
    }).pipe(Effect.mapError(() => new Failure({ reason: "binding" })));
    const ready = Effect.fn("Devbox.Callback.ready")(function* <E, R>(
      validate: Effect.Effect<void, E, R>,
    ) {
      const { store, journal } = yield* read();
      if (
        journal === null ||
        journal.pending === null ||
        journal.pending.reply === null ||
        journal.pending.request.kernelBootId !== settings.kernelBootId ||
        journal.pending.acknowledgment !== null
      )
        return yield* new Failure({ reason: "binding" });
      let pending = journal.pending;
      let reply = journal.pending.reply;
      const request = yield* Schema.decodeEffect(Protocol.ReadinessRequest)({
        observationId: pending.observationId,
        protocol: 22,
        herdrVersion: "0.9.0",
        taskAuthorized: false,
      }).pipe(Effect.mapError(() => new Failure({ reason: "binding" })));
      const send = Effect.gen(function* () {
        // Refresh only by exact enrollment replay, never by inventing another epoch.
        if ((yield* Clock.currentTimeMillis) >= reply.expiresAt - 30_000) {
          const refreshed = yield* client
            .enroll(journal.credential, pending.request)
            .pipe(
              Effect.mapError((failure) =>
                failure.retryable ? failure : new Failure({ reason: "binding" }),
              ),
            );
          if (
            refreshed.grant.epoch !== reply.grant.epoch ||
            refreshed.grant.challenge !== reply.grant.challenge ||
            refreshed.grant.nextRecoveryRevision !== reply.grant.nextRecoveryRevision
          )
            return yield* new Failure({ reason: "binding" });
          reply = refreshed;
          pending = { ...pending, reply };
          yield* store.write({ ...journal, pending });
        }
        // Execute again after refresh and on EVERY HTTP attempt, never cache a ping.
        // Wrap native failures so the HTTP retry policy cannot retry them.
        const validation = yield* Effect.result(validate);
        if (validation._tag === "Failure") return validation;
        const acknowledgment = yield* client.ready(reply.readinessCredential, request);
        return { _tag: "Success" as const, success: acknowledgment };
      });
      const acknowledgment = yield* send.pipe(
        Effect.retry({
          schedule: backoff,
          while: (failure) =>
            Effect.gen(function* () {
              if (failure._tag !== "Runtime.CallbackFailure") return false;
              if (failure.retryable) return true;
              // Expiry may occur while ready is in flight. The next pass replays enroll;
              // permanent failure of that replay must still stop the supervisor.
              return (
                failure.reason === "rejected" && (yield* Clock.currentTimeMillis) >= reply.expiresAt
              );
            }),
        }),
        Effect.mapError(() => new Failure({ reason: "binding" })),
      );
      if (acknowledgment._tag === "Failure") return yield* Effect.fail(acknowledgment.failure);
      yield* store.write({
        ...journal,
        pending: { ...pending, acknowledgment: acknowledgment.success },
      });
    });
    const commands = Effect.fn("Devbox.Callback.commands")(function* <R>(
      execute: (command: Protocol.RuntimeCommand) => Effect.Effect<CommandResult, never, R>,
    ) {
      const { store, journal } = yield* read();
      if (
        journal === null ||
        journal.pending === null ||
        journal.pending.reply === null ||
        journal.pending.request.kernelBootId !== settings.kernelBootId ||
        journal.pending.acknowledgment === null
      )
        return yield* new Failure({ reason: "binding" });
      let pending = journal.pending;
      let reply = journal.pending.reply;
      // Same exact-replay refresh as readiness: a new epoch is never invented locally.
      const credential = Effect.gen(function* () {
        if ((yield* Clock.currentTimeMillis) < reply.expiresAt - 60_000)
          return reply.readinessCredential;
        const refreshed = yield* retry(client.enroll(journal.credential, pending.request)).pipe(
          Effect.mapError(() => new Failure({ reason: "binding" })),
        );
        if (
          refreshed.grant.epoch !== reply.grant.epoch ||
          refreshed.grant.challenge !== reply.grant.challenge ||
          refreshed.grant.nextRecoveryRevision !== reply.grant.nextRecoveryRevision
        )
          return yield* new Failure({ reason: "binding" });
        reply = refreshed;
        pending = { ...pending, reply };
        yield* store.write({ ...journal, pending });
        return reply.readinessCredential;
      });
      // Long-poll continuously while work is flowing; a held poll keeps the Task object busy, so
      // an idle box switches to short checks spaced further and further apart. The spacing stays
      // under control's stale threshold, so a queued command never triggers a needless wake.
      let activeUntil = (yield* Clock.currentTimeMillis) + activeWindowMs;
      let idlePolls = 0;
      while (true) {
        const token = yield* credential;
        const now = yield* Clock.currentTimeMillis;
        const active = now < activeUntil;
        const polled = yield* retry(client.poll(token, { waitMs: active ? 20_000 : 0 })).pipe(
          Effect.mapError(() => new Failure({ reason: "binding" })),
        );
        const command = polled.command;
        if (command === null) {
          if (!active) {
            yield* Effect.sleep(
              Duration.millis(Math.min(idleIntervalMaxMs, idleIntervalMs * 2 ** idlePolls)),
            );
            idlePolls = Math.min(idlePolls + 1, 8);
          }
          continue;
        }
        const result = yield* execute(command);
        const fresh = yield* credential;
        yield* retry(client.observe(fresh, { commandId: command.id, result })).pipe(
          Effect.mapError(() => new Failure({ reason: "binding" })),
        );
        activeUntil = (yield* Clock.currentTimeMillis) + activeWindowMs;
        idlePolls = 0;
      }
    });
    return Service.of({ bound: true, enroll, ready, commands });
  }),
);

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const url = yield* Config.option(Config.string("NOTUS_CONTROL_URL"));
    const token = yield* Config.option(Config.redacted("NOTUS_BOOTSTRAP_TOKEN"));
    if (Option.isNone(url) && Option.isNone(token))
      return Layer.succeed(Service, {
        bound: false,
        enroll: Effect.void,
        ready: Effect.fn("Devbox.Callback.ready")(
          <E, R>(validate: Effect.Effect<void, E, R>) => validate,
        ),
        // Unbound runs have no control to pull from; stay alive as before.
        commands: () => Effect.never,
      });
    if (
      Option.isNone(url) ||
      Option.isNone(token) ||
      url.value.length === 0 ||
      Redacted.value(token.value).length === 0
    )
      return yield* new Failure({ reason: "binding" });
    return layerNoDeps.pipe(
      Layer.provide(
        RuntimeClient.layer.pipe(
          Layer.provide(Layer.succeed(RuntimeClient.Configuration, { controlUrl: url.value })),
        ),
      ),
      Layer.provide(
        Layer.succeed(Configuration, { controlUrl: url.value, bootstrap: token.value }),
      ),
    );
  }).pipe(Effect.mapError(() => new Failure({ reason: "binding" }))),
);
export * as Callback from "./callback";

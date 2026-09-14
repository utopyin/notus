import { Sqlite } from "@notus/cloudflare/sqlite";
import * as Json from "@notus/contracts/json";
import { and, desc, eq, or } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import * as Struct from "effect/Struct";
import { ProvisioningFailure } from "./errors";
import {
  attempts,
  enrollments,
  environments,
  provisioning,
  ProvisioningState,
  readiness,
  repositories,
  wakes,
} from "./schema";
import { Environment } from "@notus/workspaces/types";
import {
  Bootstrap,
  Claim,
  Enrollment,
  EnrollmentContext,
  EnrollmentIdentity,
  EpochGrant,
  Initialize,
  Millis,
  ProvisioningResult,
  ProvisioningStatus,
  Readiness,
  ReadinessReceipt,
  RepositoryRef,
  WakeReceipt,
} from "./types";

// Operational bounds only. Neither expires an assignment nor limits a human wait.
const claimDuration = 30_000;
const startupDuration = 10 * 60_000;
const fail = (reason: ProvisioningFailure["reason"]) => new ProvisioningFailure({ reason });
const decodeInput = Effect.fn("Provisioning.decodeInput")(
  function* <A, I>(schema: Schema.Codec<A, I>, input: unknown) {
    const inert = yield* Json.snapshot(input);
    return yield* Schema.decodeUnknownEffect(schema)(inert);
  },
  Effect.mapError(() => fail("invalid-input")),
);
const status = (s: ProvisioningState, active: boolean): ProvisioningStatus => ({
  attemptId: s.bootstrap.attemptId,
  taskId: s.bootstrap.taskId,
  workspaceId: s.bootstrap.workspaceId,
  generation: s.bootstrap.generation,
  active,
  phase: s.phase,
  pendingWork: s.claim?.work ?? s.nextWork,
  providerName: s.providerName,
  blockedReason: s.blockedReason,
  resourceId: s.resource?.id ?? null,
  instanceId: s.resource?.instanceId ?? null,
  runtimeEpoch: s.runtimeEpoch,
  lastReadyAt: s.ready?.acceptedAt ?? null,
  lastReadyEpoch: s.ready?.observation.epoch ?? null,
  observedAt: s.updatedAt,
  taskAuthorized: false,
});
const blocked = (
  s: ProvisioningState,
  reason: ProvisioningState["blockedReason"],
  now: number,
): ProvisioningState =>
  Struct.assign(s, {
    phase: "blocked" as const,
    blockedReason:
      s.blockedReason === "recovery-unverified" && reason !== "external-expired"
        ? "recovery-unverified"
        : reason,
    activationUncertain: s.activationUncertain || s.claim?.work === "activate",
    claim: null,
    nextWork: null,
    dueAt: null,
    startupDeadline: null,
    enrollmentExpected: false,
    updatedAt: now,
  });

const within = (db: Sqlite.Queries, crypto: Crypto.Crypto) => {
  const save = Effect.fn("Provisioning.save")(function* (s: ProvisioningState) {
    yield* Schema.decodeEffect(ProvisioningState)(s);
    yield* db
      .update(provisioning)
      .set({ state: s })
      .where(eq(provisioning.attemptId, s.bootstrap.attemptId));
  });
  const load = Effect.fn("Provisioning.load")(function* (id: string) {
    const [row] = yield* db.select().from(provisioning).where(eq(provisioning.attemptId, id));
    if (!row) return yield* fail("not-found");
    return yield* Schema.decodeEffect(ProvisioningState)(row.state);
  });
  const active = Effect.gen(function* () {
    const rows = yield* db.select().from(attempts).where(eq(attempts.active, true));
    if (rows.length > 1) return yield* fail("conflict");
    const row = rows[0];
    if (!row || (row.mode !== "readiness" && row.mode !== "operator")) return null;
    // An operator attempt owns provisioning only once the operator asked for a box.
    const [bound] = yield* db
      .select({ attemptId: provisioning.attemptId })
      .from(provisioning)
      .where(eq(provisioning.attemptId, row.id));
    if (!bound) return null;
    const s = yield* load(row.id);
    if (s.bootstrap.generation !== row.generation || s.bootstrap.taskId !== row.taskId)
      return yield* fail("stale-binding");
    return s;
  });
  const requireActive = Effect.gen(function* () {
    const s = yield* active;
    if (!s) return yield* fail("not-found");
    return s;
  });
  const checkTime = Effect.fn("Provisioning.checkTime")(function* (
    s: ProvisioningState,
    now: number,
  ) {
    yield* Schema.decodeEffect(Millis)(now);
    if (now < s.updatedAt) return yield* fail("invalid-input");
  });
  const bind = Effect.fn("Provisioning.bind")(function* (binding: Bootstrap) {
    const s = yield* requireActive;
    if (!Equal.equals(s.bootstrap, binding) || s.blockedReason === "external-expired")
      return yield* fail("stale-binding");
    return s;
  });
  const current = active.pipe(Effect.map((s) => (s ? status(s, true) : null)));
  const get = Effect.fn("Provisioning.get")(function* (attemptId: string) {
    yield* Schema.decodeEffect(Schema.NonEmptyString)(attemptId);
    const [row] = yield* db.select().from(attempts).where(eq(attempts.id, attemptId));
    if (!row || (row.mode !== "readiness" && row.mode !== "operator")) return null;
    return status(yield* load(attemptId), row.active);
  });
  const capture = Effect.fn("Provisioning.capture")(function* (
    input: Environment | null,
    now: number,
  ) {
    yield* Schema.decodeEffect(Millis)(now);
    const [existing] = yield* db.select().from(environments).where(eq(environments.singleton, 1));
    if (existing) return yield* Schema.decodeEffect(Environment)(existing.environment);
    if (input === null) return null;
    const environment = yield* decodeInput(Environment, input);
    yield* db.insert(environments).values({ singleton: 1, environment, capturedAt: now });
    return environment;
  });
  const captured = Effect.gen(function* () {
    const [existing] = yield* db.select().from(environments).where(eq(environments.singleton, 1));
    return existing ? yield* Schema.decodeEffect(Environment)(existing.environment) : null;
  }).pipe(Effect.withSpan("Provisioning.captured"));
  const captureRepository = Effect.fn("Provisioning.captureRepository")(function* (
    input: RepositoryRef | null,
    now: number,
  ) {
    yield* Schema.decodeEffect(Millis)(now);
    const [existing] = yield* db.select().from(repositories).where(eq(repositories.singleton, 1));
    if (existing) return yield* Schema.decodeEffect(RepositoryRef)(existing.repository);
    if (input === null) return null;
    const repository = yield* decodeInput(RepositoryRef, input);
    yield* db.insert(repositories).values({ singleton: 1, repository, capturedAt: now });
    return repository;
  });
  const repository = Effect.gen(function* () {
    const [existing] = yield* db.select().from(repositories).where(eq(repositories.singleton, 1));
    return existing ? yield* Schema.decodeEffect(RepositoryRef)(existing.repository) : null;
  }).pipe(Effect.withSpan("Provisioning.repository"));
  const fresh = (params: Initialize, bootstrap: Bootstrap, now: number): ProvisioningState => ({
    bootstrap,
    environment: params.environment,
    providerName: `notus-${bootstrap.operationId}`,
    launchVersion: 1,
    phase: params.environment ? "pending-create" : "blocked",
    blockedReason: params.environment ? null : "missing-environment",
    resource: null,
    claimGeneration: 0,
    claim: null,
    nextWork: params.environment ? "create" : null,
    dueAt: params.environment ? now : null,
    startupDeadline: params.environment ? now + startupDuration : null,
    activationConfirmed: false,
    activationUncertain: false,
    enrollmentExpected: false,
    recoveryRevision: 0,
    runtimeEpoch: 0,
    startupEpoch: 1,
    enrollment: null,
    grant: null,
    ready: null,
    updatedAt: now,
  });
  const initialize = Effect.fn("Provisioning.initialize")(function* (
    input: Initialize,
    now: number,
  ) {
    const params = yield* decodeInput(Initialize, input);
    yield* Schema.decodeEffect(Millis)(now);
    if (params.environment && params.environment.workspaceId !== params.workspaceId)
      return yield* fail("invalid-input");
    const history = yield* db.select().from(attempts).orderBy(desc(attempts.generation));
    if (history.some((a) => a.taskId !== params.taskId)) return yield* fail("conflict");
    const existing = history.find((a) => a.active);
    if (existing) {
      if (existing.mode !== "readiness" && existing.mode !== "operator")
        return yield* fail("conflict");
      const [bound] = yield* db
        .select({ attemptId: provisioning.attemptId })
        .from(provisioning)
        .where(eq(provisioning.attemptId, existing.id));
      if (bound) {
        const s = yield* load(existing.id);
        if (s.bootstrap.workspaceId !== params.workspaceId) return yield* fail("conflict");
        // Configuration selection belongs to the first committed initialization, not its retries.
        return status(s, true);
      }
      if (existing.mode !== "operator") return yield* fail("conflict");
      // The operator asked for a box: bind provisioning to its already active attempt.
      const operationId = yield* crypto.randomUUIDv4;
      const capabilityId = yield* crypto.randomUUIDv4;
      const s = fresh(
        params,
        {
          taskId: params.taskId,
          workspaceId: params.workspaceId,
          attemptId: existing.id,
          generation: existing.generation,
          operationId,
          capabilityId,
        },
        now,
      );
      yield* db.insert(provisioning).values({
        attemptId: existing.id,
        operationId,
        capabilityId,
        providerName: s.providerName,
        state: s,
      });
      return status(s, true);
    }
    // No replacement API: historical attempts require explicit external intervention.
    if (history.length > 0) return yield* fail("conflict");
    const id = yield* crypto.randomUUIDv4;
    const operationId = yield* crypto.randomUUIDv4;
    const capabilityId = yield* crypto.randomUUIDv4;
    const s = fresh(
      params,
      {
        taskId: params.taskId,
        workspaceId: params.workspaceId,
        attemptId: id,
        generation: 1,
        operationId,
        capabilityId,
      },
      now,
    );
    yield* db.insert(attempts).values({
      id,
      taskId: params.taskId,
      generation: 1,
      mode: "readiness",
      active: true,
      createdAt: now,
    });
    yield* db
      .insert(provisioning)
      .values({ attemptId: id, operationId, capabilityId, providerName: s.providerName, state: s });
    return status(s, true);
  });
  const claim = Effect.fn("Provisioning.claim")(function* (now: number) {
    yield* Schema.decodeEffect(Millis)(now);
    let s = yield* active;
    if (!s) return null;
    yield* checkTime(s, now);
    if (s.startupDeadline !== null && now >= s.startupDeadline) {
      yield* save(blocked(s, "startup-timeout", now));
      return null;
    }
    if (s.claim) {
      if (now < s.claim.recoverAt) return null;
      const work = s.claim.work;
      s = {
        ...s,
        claim: null,
        activationUncertain: work === "activate" || s.activationUncertain,
        nextWork:
          work === "create"
            ? "reconcile-create"
            : work === "activate"
              ? "reconcile-activation"
              : work,
        phase: work === "create" ? "ambiguous-create" : s.phase,
        dueAt: now,
      };
    }
    if (!s.nextWork || s.dueAt === null || s.dueAt > now || !s.environment) return null;
    const claimed: Claim = {
      bootstrap: s.bootstrap,
      claimGeneration: s.claimGeneration + 1,
      work: s.nextWork,
      recoverAt: Math.min(now + claimDuration, s.startupDeadline ?? now + claimDuration),
      providerName: s.providerName,
      launchVersion: s.launchVersion,
      environment: s.environment,
      resource: s.resource,
    };
    s = {
      ...s,
      claim: claimed,
      claimGeneration: claimed.claimGeneration,
      nextWork: null,
      dueAt: null,
      updatedAt: now,
      phase:
        claimed.work === "create"
          ? "creating"
          : claimed.work === "activate"
            ? "activating"
            : s.phase,
      enrollmentExpected: claimed.work === "activate" ? true : s.enrollmentExpected,
    };
    yield* save(s);
    return claimed;
  });
  const record = Effect.fn("Provisioning.record")(function* (
    input: Claim,
    output: ProvisioningResult,
    now: number,
  ) {
    const claimed = yield* decodeInput(Claim, input);
    const result = yield* decodeInput(ProvisioningResult, output);
    let s = yield* bind(claimed.bootstrap);
    yield* checkTime(s, now);
    if (!Equal.equals(s.claim, claimed) || now >= claimed.recoverAt)
      return yield* fail("stale-claim");
    const work = claimed.work;
    s = { ...s, claim: null, updatedAt: now };
    switch (result._tag) {
      case "Assigned": {
        if (
          (work !== "create" && work !== "reconcile-create") ||
          s.resource ||
          result.operationId !== s.bootstrap.operationId ||
          result.resource.name !== s.providerName
        )
          return yield* fail("conflict");
        s = {
          ...s,
          resource: result.resource,
          phase: "created",
          blockedReason: null,
          nextWork: "activate",
          dueAt: now,
        };
        break;
      }
      case "Lost": {
        s = {
          ...s,
          activationUncertain: work === "activate" || s.activationUncertain,
          nextWork:
            work === "create"
              ? "reconcile-create"
              : work === "activate"
                ? "reconcile-activation"
                : work,
          phase: work === "create" ? "ambiguous-create" : s.phase,
          dueAt: now + claimDuration,
        };
        break;
      }
      case "NotFound":
      case "Unproven": {
        if (work === "create" || work === "activate") return yield* fail("conflict");
        s = blocked(
          s,
          work === "reconcile-create" ? "create-unresolved" : "activation-unresolved",
          now,
        );
        break;
      }
      case "Activated":
      case "Running": {
        if (
          !s.resource ||
          result.resourceId !== s.resource.id ||
          (work !== "activate" && work !== "reconcile-activation" && work !== "probe-wake") ||
          (result._tag === "Activated" && work === "probe-wake")
        )
          return yield* fail("conflict");
        // A callback may have committed a newer identity while this provider call was outside
        // the gate. Its result cannot move the resource back to the claim's old incarnation.
        if (
          s.resource.instanceId !== claimed.resource?.instanceId &&
          s.enrollment?.instanceId === s.resource.instanceId &&
          result.instanceId !== s.resource.instanceId
        )
          return yield* fail("stale-claim");
        if (s.resource.instanceId !== result.instanceId) {
          const history = yield* db
            .select()
            .from(enrollments)
            .where(eq(enrollments.attemptId, s.bootstrap.attemptId));
          const previous = yield* Schema.decodeEffect(Schema.Array(Enrollment))(
            history.map((row) => row.request),
          );
          if (previous.some((old) => old.instanceId === result.instanceId))
            return yield* fail("stale-claim");
        }
        if (
          s.blockedReason === "recovery-unverified" &&
          result.instanceId === s.resource.instanceId
        ) {
          s = blocked({ ...s, activationUncertain: false }, "recovery-unverified", now);
          break;
        }
        const sameIncarnation = s.enrollment?.instanceId === result.instanceId;
        const startupEpoch = sameIncarnation ? s.runtimeEpoch : s.runtimeEpoch + 1;
        // VM suspension may preserve the same incarnation and process memory. Its previous
        // receipt is historical readiness, not a new native health check.
        const ready = sameIncarnation && s.ready?.observation.epoch === startupEpoch;
        s = {
          ...s,
          resource: { ...s.resource, instanceId: result.instanceId },
          startupEpoch,
          enrollmentExpected: sameIncarnation ? false : s.grant?.epoch !== startupEpoch,
          activationConfirmed: true,
          activationUncertain: false,
          phase: ready ? "ready" : "awaiting-readiness",
          blockedReason: null,
          startupDeadline: ready ? null : (s.startupDeadline ?? now + startupDuration),
        };
        break;
      }
      case "Stopped": {
        if (
          !s.resource ||
          result.resourceId !== s.resource.id ||
          (work !== "probe-wake" && work !== "reconcile-activation")
        )
          return yield* fail("conflict");
        if (work === "reconcile-activation" || s.activationUncertain) {
          // Unknown Activate is never repeated automatically, even if a later fetch says stopped.
          s = blocked(s, "activation-unresolved", now);
        } else {
          s = {
            ...s,
            phase: "created",
            blockedReason: s.blockedReason === "recovery-unverified" ? s.blockedReason : null,
            nextWork: "activate",
            dueAt: now,
            startupDeadline: now + startupDuration,
            startupEpoch: s.runtimeEpoch + 1,
            activationConfirmed: false,
            enrollmentExpected: false,
          };
        }
        break;
      }
      case "Rejected":
        s = blocked(
          { ...s, activationUncertain: work === "activate" ? false : s.activationUncertain },
          "provider-rejected",
          now,
        );
        break;
      case "Throttled":
        if (work !== "create" || s.resource) return yield* fail("conflict");
        s = blocked(s, "provider-throttled", now);
        break;
      case "ExternalExpire": {
        if (!s.resource || result.resourceId !== s.resource.id) return yield* fail("conflict");
        s = blocked(s, "external-expired", now);
        // Keep the assignment as evidence; this report revokes enrollment and all automatic work.
        break;
      }
    }
    yield* save(s);
    return status(s, true);
  });
  const requestWake = Effect.fn("Provisioning.requestWake")(function* (
    inputId: string,
    now: number,
  ) {
    yield* Schema.decodeEffect(Schema.NonEmptyString)(inputId);
    yield* Schema.decodeEffect(Millis)(now);
    const [existing] = yield* db.select().from(wakes).where(eq(wakes.inputId, inputId));
    if (existing) return yield* Schema.decodeEffect(WakeReceipt)(existing.receipt);
    let s = yield* requireActive;
    yield* checkTime(s, now);
    // Coalesce new human wake events with work already in flight. No event can reopen Create.
    if (
      !s.claim &&
      !s.nextWork &&
      !s.enrollmentExpected &&
      (s.startupDeadline === null || s.phase === "blocked") &&
      s.environment &&
      s.blockedReason !== "external-expired" &&
      ((s.blockedReason !== "provider-rejected" && s.blockedReason !== "provider-throttled") ||
        s.resource !== null)
    ) {
      s = {
        ...s,
        nextWork: s.resource ? "probe-wake" : "reconcile-create",
        dueAt: now,
        startupDeadline: now + startupDuration,
        updatedAt: now,
      };
      yield* save(s);
    }
    const receipt: WakeReceipt = { inputId, requestedAt: now, status: status(s, true) };
    yield* db.insert(wakes).values({ inputId, attemptId: s.bootstrap.attemptId, receipt });
    return receipt;
  });
  const context = Effect.fn("Provisioning.context")(function* (input: Bootstrap) {
    const s = yield* bind(yield* decodeInput(Bootstrap, input));
    return EnrollmentContext.make({
      bootstrap: s.bootstrap,
      resource: s.resource,
      previous: s.enrollment,
      phase: s.phase,
      recoveryRevision: s.recoveryRevision,
      enrollmentExpected: s.enrollmentExpected,
      activationConfirmed: s.activationConfirmed,
    });
  });
  const replayEnrollment = Effect.fn("Provisioning.replayEnrollment")(function* (
    input: EnrollmentIdentity,
  ) {
    const request = yield* decodeInput(EnrollmentIdentity, input);
    const s = yield* bind(request.bootstrap);
    if (!s.resource || s.resource.id !== request.resourceId) return yield* fail("stale-binding");
    const rows = yield* db
      .select()
      .from(enrollments)
      .where(
        and(
          eq(enrollments.attemptId, s.bootstrap.attemptId),
          or(
            eq(enrollments.requestId, request.requestId),
            eq(enrollments.revision, request.expectedRecoveryRevision),
          ),
        ),
      );
    const replay = rows[0];
    if (replay) {
      const original = yield* Schema.decodeEffect(EnrollmentIdentity)(replay.request);
      if (rows.length !== 1 || !Equal.equals(original, request)) return yield* fail("conflict");
      return yield* Schema.decodeEffect(EpochGrant)(replay.grant);
    }
    return null;
  });
  const enroll = Effect.fn("Provisioning.enroll")(function* (input: Enrollment, now: number) {
    const identity = yield* decodeInput(EnrollmentIdentity, input);
    const replay = yield* replayEnrollment(identity);
    if (replay) return Result.succeed(replay);
    const request = yield* decodeInput(Enrollment, input);
    let s = yield* bind(request.bootstrap);
    yield* Schema.decodeEffect(Millis)(now);
    if (!s.resource || s.resource.id !== request.resourceId) return yield* fail("stale-binding");
    // Before Activate returns, Control's independently fetched identity can establish the
    // current instance. Once activation is confirmed, only that exact instance may enroll.
    if (s.activationConfirmed && s.resource.instanceId !== request.instanceId)
      return yield* fail("stale-binding");
    yield* checkTime(s, now);
    if (
      !s.enrollmentExpected ||
      s.recoveryRevision !== request.expectedRecoveryRevision ||
      s.startupDeadline === null ||
      now >= s.startupDeadline ||
      s.phase === "blocked"
    )
      return yield* fail("enrollment-not-expected");
    const history = yield* db
      .select()
      .from(enrollments)
      .where(eq(enrollments.attemptId, s.bootstrap.attemptId));
    const prior = yield* Schema.decodeEffect(Schema.Array(Enrollment))(
      history.map((row) => row.request),
    );
    if (
      s.enrollment
        ? request.bootEvidence !== "verified-new-boot" ||
          request.previousTermination?.instanceId !== s.enrollment.instanceId ||
          request.instanceId === s.enrollment.instanceId ||
          prior.some(
            (old) => old.kernelBootId === request.kernelBootId || old.runId === request.runId,
          )
        : request.bootEvidence !== "initial" || request.previousTermination !== null
    ) {
      yield* save(blocked(s, "recovery-unverified", now));
      // Commit the operational block before exposing the typed rejection outside the transaction.
      return Result.fail(fail("recovery-unverified"));
    }
    const grant: EpochGrant = {
      epoch: s.runtimeEpoch + 1,
      challenge: yield* crypto.randomUUIDv4,
      nextRecoveryRevision: s.recoveryRevision + 1,
    };
    yield* db.insert(enrollments).values({
      attemptId: s.bootstrap.attemptId,
      revision: request.expectedRecoveryRevision,
      requestId: request.requestId,
      request,
      grant,
      acceptedAt: now,
    });
    s = {
      ...s,
      resource: { ...s.resource, instanceId: request.instanceId },
      enrollment: request,
      grant,
      startupEpoch: grant.epoch,
      runtimeEpoch: grant.epoch,
      recoveryRevision: grant.nextRecoveryRevision,
      enrollmentExpected: false,
      updatedAt: now,
    };
    yield* save(s);
    return Result.succeed(grant);
  });
  const acceptReadiness = Effect.fn("Provisioning.acceptReadiness")(function* (
    input: Readiness,
    now: number,
  ) {
    const observation = yield* decodeInput(Readiness, input);
    let s = yield* bind(observation.bootstrap);
    yield* Schema.decodeEffect(Millis)(now);
    const rows = yield* db
      .select()
      .from(readiness)
      .where(
        and(
          eq(readiness.attemptId, s.bootstrap.attemptId),
          or(
            eq(readiness.observationId, observation.observationId),
            eq(readiness.epoch, observation.epoch),
          ),
        ),
      );
    const replay = rows[0];
    if (replay) {
      const receipt = yield* Schema.decodeEffect(ReadinessReceipt)(replay.receipt);
      if (rows.length !== 1 || !Equal.equals(receipt.observation, observation))
        return yield* fail("conflict");
      return receipt;
    }
    if (
      !s.resource ||
      observation.resourceId !== s.resource.id ||
      observation.instanceId !== s.resource.instanceId
    )
      return yield* fail("stale-binding");
    yield* checkTime(s, now);
    if (
      !s.grant ||
      !s.enrollment ||
      s.grant.epoch !== observation.epoch ||
      s.startupEpoch !== observation.epoch ||
      s.grant.challenge !== observation.challenge ||
      s.enrollment.runId !== observation.runId ||
      s.phase === "blocked" ||
      s.startupDeadline === null ||
      now >= s.startupDeadline
    )
      return yield* fail("stale-readiness");
    const receipt: ReadinessReceipt = { observation, acceptedAt: now };
    yield* db.insert(readiness).values({
      attemptId: s.bootstrap.attemptId,
      epoch: observation.epoch,
      observationId: observation.observationId,
      receipt,
    });
    // Native readiness and provider activation are joint conditions, in either arrival order.
    s = {
      ...s,
      ready: receipt,
      phase: s.activationConfirmed ? "ready" : s.phase,
      startupDeadline: s.activationConfirmed ? null : s.startupDeadline,
      updatedAt: now,
    };
    yield* save(s);
    return receipt;
  });
  /** Re-arms Create after a 429 refusal. Nothing was created, so no box can be duplicated. */
  const retryThrottled = Effect.fn("Provisioning.retryThrottled")(function* (now: number) {
    yield* Schema.decodeEffect(Millis)(now);
    let s = yield* requireActive;
    yield* checkTime(s, now);
    if (
      s.phase === "blocked" &&
      s.blockedReason === "provider-throttled" &&
      s.resource === null &&
      s.claim === null &&
      s.environment
    ) {
      s = {
        ...s,
        phase: "pending-create",
        blockedReason: null,
        nextWork: "create",
        dueAt: now,
        startupDeadline: now + startupDuration,
        updatedAt: now,
      };
      yield* save(s);
    }
    return status(s, true);
  });
  const nextWake = active.pipe(
    Effect.map((s) => {
      if (!s) return null;
      const deadlines = [s.claim?.recoverAt, s.dueAt, s.startupDeadline].filter(
        (n): n is number => n !== null && n !== undefined,
      );
      return deadlines.length ? Math.min(...deadlines) : null;
    }),
  );
  return {
    initialize,
    capture,
    captured,
    captureRepository,
    repository,
    get,
    current,
    claim,
    record,
    requestWake,
    retryThrottled,
    nextWake,
    context,
    replayEnrollment,
    enroll,
    acceptReadiness,
  };
};

/** One task per store. Callers own authorization, provider evidence, alarms and response handoffs.
 * Only claim carries opaque configuration. Never log/serialize it to a user-facing status.
 * Keep the captured Crypto implementation synchronous for Drizzle's transactionSync.
 * Claims last 30 seconds; startup/reconciliation gets 10 minutes. Persist nextWake as an alarm.
 * Timeout blocks status, not the assignment. Only an explicit wake event can reopen reconciliation.
 * Attempt generation stays 1: initialize refuses historical/replacement attempts in this slice.
 * Enrollment/readiness/wake history is retained without pruning for durable replay.
 * Old exact enrollment/ready retries acknowledge history; they never restore current authority.
 * record consumes a claim. Repeating record after commit returns stale-claim; read current instead.
 * WakeReceipt acknowledges admission only. Control must persist its own per-input final response
 * from ProvisioningStatus, including responsePolicy/outbox handoffs. No simulated invocation is made.
 * No replacement, same-kernel recovery, continuous health or model authority is supported.
 */
export interface Interface {
  readonly initialize: (
    params: Initialize,
    now: number,
  ) => Effect.Effect<ProvisioningStatus, ProvisioningFailure>;
  /** Records the environment snapshot once; later inputs never replace it. */
  readonly capture: (
    environment: Environment | null,
    now: number,
  ) => Effect.Effect<Environment | null, ProvisioningFailure>;
  readonly captured: Effect.Effect<Environment | null, ProvisioningFailure>;
  readonly captureRepository: (
    repository: RepositoryRef | null,
    now: number,
  ) => Effect.Effect<RepositoryRef | null, ProvisioningFailure>;
  readonly repository: Effect.Effect<RepositoryRef | null, ProvisioningFailure>;
  readonly get: (
    attemptId: string,
  ) => Effect.Effect<ProvisioningStatus | null, ProvisioningFailure>;
  readonly current: Effect.Effect<ProvisioningStatus | null, ProvisioningFailure>;
  readonly claim: (now: number) => Effect.Effect<Claim | null, ProvisioningFailure>;
  readonly record: (
    claim: Claim,
    result: ProvisioningResult,
    now: number,
  ) => Effect.Effect<ProvisioningStatus, ProvisioningFailure>;
  readonly requestWake: (
    inputId: string,
    now: number,
  ) => Effect.Effect<WakeReceipt, ProvisioningFailure>;
  /** Only a throttled Create with no resource is re-armed; any other state is returned unchanged. */
  readonly retryThrottled: (now: number) => Effect.Effect<ProvisioningStatus, ProvisioningFailure>;
  readonly nextWake: Effect.Effect<number | null, ProvisioningFailure>;
  readonly context: (bootstrap: Bootstrap) => Effect.Effect<EnrollmentContext, ProvisioningFailure>;
  readonly replayEnrollment: (
    request: EnrollmentIdentity,
  ) => Effect.Effect<EpochGrant | null, ProvisioningFailure>;
  readonly enroll: (
    request: Enrollment,
    now: number,
  ) => Effect.Effect<EpochGrant, ProvisioningFailure>;
  readonly acceptReadiness: (
    observation: Readiness,
    now: number,
  ) => Effect.Effect<ReadinessReceipt, ProvisioningFailure>;
}
export class Service extends Context.Service<Service, Interface>()(
  "@notus/executions/Provisioning",
) {}
export const layerNoDeps = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = yield* Sqlite.Service;
    const crypto = yield* Crypto.Crypto;
    const atomic = <A, E>(run: (operations: ReturnType<typeof within>) => Effect.Effect<A, E>) =>
      db
        .transaction((tx) => run(within(tx, crypto)))
        .pipe(
          Effect.mapError((error) =>
            Schema.is(ProvisioningFailure)(error)
              ? error
              : fail(Schema.isSchemaError(error) ? "invalid-input" : "storage"),
          ),
        );
    return Service.of({
      initialize: Effect.fn("Provisioning.initializeAtomic")((params, now) =>
        atomic((q) => q.initialize(params, now)),
      ),
      capture: Effect.fn("Provisioning.captureAtomic")((environment, now) =>
        atomic((q) => q.capture(environment, now)),
      ),
      captured: atomic((q) => q.captured),
      captureRepository: Effect.fn("Provisioning.captureRepositoryAtomic")((repository, now) =>
        atomic((q) => q.captureRepository(repository, now)),
      ),
      repository: atomic((q) => q.repository),
      get: Effect.fn("Provisioning.getAtomic")((id) => atomic((q) => q.get(id))),
      current: atomic((q) => q.current),
      claim: Effect.fn("Provisioning.claimAtomic")((now) => atomic((q) => q.claim(now))),
      record: Effect.fn("Provisioning.recordAtomic")((claim, result, now) =>
        atomic((q) => q.record(claim, result, now)),
      ),
      requestWake: Effect.fn("Provisioning.requestWakeAtomic")((id, now) =>
        atomic((q) => q.requestWake(id, now)),
      ),
      retryThrottled: Effect.fn("Provisioning.retryThrottledAtomic")((now) =>
        atomic((q) => q.retryThrottled(now)),
      ),
      nextWake: atomic((q) => q.nextWake),
      context: Effect.fn("Provisioning.contextAtomic")((input) => atomic((q) => q.context(input))),
      replayEnrollment: Effect.fn("Provisioning.replayEnrollmentAtomic")((input) =>
        atomic((q) => q.replayEnrollment(input)),
      ),
      enroll: Effect.fn("Provisioning.enrollAtomic")((request, now) =>
        atomic((q) => q.enroll(request, now)).pipe(
          Effect.flatMap((result: Result.Result<EpochGrant, ProvisioningFailure>) =>
            Result.match(result, {
              onSuccess: (grant) => Effect.succeed(grant),
              onFailure: (error) => Effect.fail(error),
            }),
          ),
        ),
      ),
      acceptReadiness: Effect.fn("Provisioning.acceptReadinessAtomic")((observation, now) =>
        atomic((q) => q.acceptReadiness(observation, now)),
      ),
    });
  }),
);
export const layer = layerNoDeps;
export * as Provisioning from "./provisioning";

import { Commands } from "@notus/executions/commands";
import { Devbox } from "@notus/executions/devbox";
import { Conflict as RuntimeConflict, ProvisioningFailure } from "@notus/executions/errors";
import { Provisioning } from "@notus/executions/provisioning";
import {
  Enrollment,
  EnrollmentIdentity,
  type EnrollmentContext,
  type EpochGrant,
  Readiness,
} from "@notus/executions/types";
import { State } from "@notus/tasks/state";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Auth from "./auth";
import { Failure } from "./errors";
import * as Protocol from "./protocol";

type EnrollmentCapability = Extract<Auth.Capability, { readonly _tag: "Enrollment" }>;
type ReadinessCapability = Extract<Auth.Capability, { readonly _tag: "Readiness" }>;
const fail = (reason: Failure["reason"]) => new Failure({ reason });

const identity = (capability: EnrollmentCapability, request: Protocol.EnrollmentRequest) =>
  EnrollmentIdentity.make({
    bootstrap: capability.bootstrap,
    expectedRecoveryRevision: capability.recoveryRevision,
    resourceId: request.resourceId,
    instanceId: request.instanceId,
    requestId: request.requestId,
    runId: request.runId,
    kernelBootId: request.kernelBootId,
  });

const map = (error: unknown): Failure => {
  if (Schema.is(ProvisioningFailure)(error)) {
    switch (error.reason) {
      case "storage":
        return fail("unavailable");
      case "enrollment-not-expected":
      case "recovery-unverified":
        return fail("pending");
      case "conflict":
        return fail("conflict");
      case "invalid-input":
        return fail("invalid");
      default:
        return fail("unauthorized");
    }
  }

  return fail("unavailable");
};

const make = Effect.gen(function* () {
  const state = yield* State.Service;
  const execution = yield* Provisioning.Service;
  const provider = yield* Devbox.Service;
  const authentication = yield* Auth.Service;
  const commands = yield* Commands.Service;

  /** Local-only. Verified HTTP capability routing does not bypass task closure/mode checks. */
  const context = Effect.fn("Runtime.Server.context")(function* (capability: Auth.Capability) {
    const snapshot = yield* state.snapshot;

    if (
      !snapshot.task ||
      (snapshot.task.mode !== "readiness" && snapshot.task.mode !== "operator") ||
      snapshot.task.closedAt !== null ||
      snapshot.task.id !== capability.bootstrap.taskId
    )
      return yield* fail("unauthorized");

    return yield* execution.context(capability.bootstrap).pipe(Effect.mapError(map));
  });

  const assignment = Effect.fn("Runtime.Server.assignment")(function* (
    capability: EnrollmentCapability,
  ) {
    const current = yield* context(capability);

    if (capability.recoveryRevision !== current.recoveryRevision)
      return yield* fail("unauthorized");

    if (
      !current.enrollmentExpected ||
      !current.activationConfirmed ||
      !current.resource?.instanceId
    )
      return yield* fail("pending");

    return Protocol.Assignment.make({
      resourceId: current.resource.id,
      instanceId: current.resource.instanceId,
    });
  });

  /** Local-only replay recovery, including a committed old transition after a later VM boot. */
  const replay = Effect.fn("Runtime.Server.replay")(function* (
    capability: EnrollmentCapability,
    request: Protocol.EnrollmentRequest,
  ) {
    yield* context(capability);

    return yield* execution
      .replayEnrollment(identity(capability, request))
      .pipe(Effect.mapError(map));
  });

  /** Provider I/O: the host must call this OUTSIDE its Durable Object concurrency gate. */
  const verify = Effect.fn("Runtime.Server.verify")(function* (
    capability: EnrollmentCapability,
    request: Protocol.EnrollmentRequest,
    current: EnrollmentContext,
  ) {
    if (capability.recoveryRevision !== current.recoveryRevision)
      return yield* fail("unauthorized");

    if (
      !current.enrollmentExpected ||
      !current.activationConfirmed ||
      !current.resource?.instanceId
    )
      return yield* fail("pending");

    if (
      request.resourceId !== current.resource.id ||
      request.instanceId !== current.resource.instanceId
    )
      return yield* fail("pending");

    const previousTermination = current.previous
      ? yield* provider
          .verifyReplacement(current.environment, current.previous, current.resource)
          .pipe(Effect.mapError(() => fail("pending")))
      : null;

    if (!current.previous) {
      const observed = yield* provider
        .fetch(current.environment, current.resource)
        .pipe(Effect.mapError(() => fail("unavailable")));

      if (observed.instanceId !== request.instanceId) return yield* fail("pending");
    }

    return Enrollment.make({
      ...identity(capability, request),
      bootEvidence: current.previous ? "verified-new-boot" : "initial",
      previousTermination,
    });
  });

  /** Local-only commit after independent evidence. The durable core rechecks every fence. */
  const enroll = Effect.fn("Runtime.Server.enroll")(function* (
    capability: EnrollmentCapability,
    request: Enrollment,
    now: number,
  ) {
    yield* context(capability);
    return yield* execution.enroll(request, now).pipe(Effect.mapError(map));
  });

  /** Signing is deliberately outside the store transaction and may be repeated after ack loss. */
  const reply = Effect.fn("Runtime.Server.reply")(
    function* (
      capability: EnrollmentCapability,
      request: Protocol.EnrollmentRequest,
      grant: EpochGrant,
      now: number,
    ) {
      const expiresAt = now + 15 * 60_000;

      const recoveryCredential = yield* authentication.issue(
        Auth.Capability.cases.Enrollment.make({
          audience: capability.audience,
          bootstrap: capability.bootstrap,
          recoveryRevision: grant.nextRecoveryRevision,
        }),
      );
      const readinessCredential = yield* authentication.issue(
        Auth.Capability.cases.Readiness.make({
          audience: capability.audience,
          bootstrap: capability.bootstrap,
          resourceId: request.resourceId,
          instanceId: request.instanceId,
          runId: request.runId,
          epoch: grant.epoch,
          challenge: grant.challenge,
          expiresAt,
        }),
      );

      return Protocol.EnrollmentReply.make({
        grant,
        recoveryCredential,
        readinessCredential,
        expiresAt,
      });
    },
    Effect.mapError(() => fail("unavailable")),
  );

  /** Fresh provider identity observation; bearer possession is not hardware attestation. */
  const verifyReadiness = Effect.fn("Runtime.Server.verifyReadiness")(function* (
    capability: ReadinessCapability,
    current: EnrollmentContext,
  ) {
    if (
      !current.resource ||
      current.resource.id !== capability.resourceId ||
      current.resource.instanceId !== capability.instanceId
    )
      return yield* fail("unauthorized");

    const observed = yield* provider
      .fetch(current.environment, current.resource)
      .pipe(Effect.mapError(() => fail("unavailable")));

    if (observed.instanceId !== capability.instanceId) return yield* fail("pending");
  });

  /** The caller's epoch is current and enrolled: what every readiness-credential call checks first. */
  const authorize = Effect.fn("Runtime.Server.authorize")(function* (
    capability: ReadinessCapability,
    now: number,
  ) {
    yield* context(capability);
    if (now >= capability.expiresAt) return yield* fail("unauthorized");
  });

  /** One claim attempt under the caller's epoch. The host owns any wait between attempts. */
  const poll = Effect.fn("Runtime.Server.poll")(function* (
    capability: ReadinessCapability,
    now: number,
  ) {
    yield* authorize(capability, now);

    const command = yield* commands
      .claim(capability.epoch, now)
      .pipe(Effect.mapError(() => fail("unavailable")));

    return { command };
  });

  const observe = Effect.fn("Runtime.Server.observe")(function* (
    capability: ReadinessCapability,
    request: Protocol.ObserveRequest,
    now: number,
  ) {
    yield* context(capability);

    if (now >= capability.expiresAt) return yield* fail("unauthorized");

    yield* commands
      .observe({ commandId: request.commandId, result: request.result }, capability.epoch, now)
      .pipe(
        Effect.mapError((error) =>
          Schema.is(RuntimeConflict)(error) ? fail("conflict") : fail("unavailable"),
        ),
      );

    return Protocol.ObserveReply.make({ acceptedAt: now });
  });

  const accept = Effect.fn("Runtime.Server.accept")(function* (
    capability: ReadinessCapability,
    request: Protocol.ReadinessRequest,
    now: number,
  ) {
    yield* context(capability);

    if (now >= capability.expiresAt) return yield* fail("unauthorized");

    const receipt = yield* execution
      .acceptReadiness(
        Readiness.make({
          observationId: request.observationId,
          protocol: request.protocol,
          herdrVersion: request.herdrVersion,
          taskAuthorized: request.taskAuthorized,
          bootstrap: capability.bootstrap,
          resourceId: capability.resourceId,
          instanceId: capability.instanceId,
          epoch: capability.epoch,
          runId: capability.runId,
          challenge: capability.challenge,
        }),
        now,
      )
      .pipe(Effect.mapError(map));

    return Protocol.ReadinessReply.make({ acceptedAt: receipt.acceptedAt });
  });

  return {
    context,
    assignment,
    replay,
    verify,
    enroll,
    reply,
    verifyReadiness,
    authorize,
    poll,
    observe,
    accept,
  };
});

export interface Interface extends Effect.Success<typeof make> {}

export class Service extends Context.Service<Service, Interface>()(
  "@notus/control/runtime/Server",
) {}

export const layer = Layer.effect(Service, make);

export * as Server from "./server";

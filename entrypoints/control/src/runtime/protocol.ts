import {
  Command,
  CommandResult,
  Enrollment,
  EpochGrant,
  Millis,
  Readiness,
} from "@notus/executions/types";
import * as Schema from "effect/Schema";
import type { Failure } from "./errors";

const Uuid = Schema.String.check(Schema.isPattern(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/));
// Routing and authority come from verified capabilities, never these bodies.
export const EnrollmentRequest = Schema.Struct({
  resourceId: Enrollment.fields.resourceId.check(Schema.isMaxLength(256)),
  instanceId: Enrollment.fields.instanceId.check(Schema.isMaxLength(256)),
  requestId: Uuid,
  runId: Uuid,
  kernelBootId: Uuid,
});
export interface EnrollmentRequest extends Schema.Schema.Type<typeof EnrollmentRequest> {}

export const Assignment = Schema.Struct({
  resourceId: Enrollment.fields.resourceId,
  instanceId: Enrollment.fields.instanceId,
});
export interface Assignment extends Schema.Schema.Type<typeof Assignment> {}

const Credential = Schema.RedactedFromValue(Schema.NonEmptyString);
export const EnrollmentReply = Schema.Struct({
  grant: EpochGrant,
  recoveryCredential: Credential,
  readinessCredential: Credential,
  expiresAt: Millis,
});
export interface EnrollmentReply extends Schema.Schema.Type<typeof EnrollmentReply> {}

export const ReadinessRequest = Schema.Struct({
  observationId: Uuid,
  protocol: Readiness.fields.protocol,
  herdrVersion: Readiness.fields.herdrVersion,
  taskAuthorized: Readiness.fields.taskAuthorized,
});
export interface ReadinessRequest extends Schema.Schema.Type<typeof ReadinessRequest> {}
export const ReadinessReply = Schema.Struct({ acceptedAt: Millis });
export interface ReadinessReply extends Schema.Schema.Type<typeof ReadinessReply> {}

/** The runtime pulls commands; the host may hold the request while waiting. */
export const PollRequest = Schema.Struct({
  waitMs: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 20_000 })),
});
export interface PollRequest extends Schema.Schema.Type<typeof PollRequest> {}
/** A checkout command carries its short-lived read token only on the wire, never in storage. */
export const RuntimeCommand = Schema.Struct({
  ...Command.fields,
  credential: Schema.NullOr(Schema.NonEmptyString),
});
export interface RuntimeCommand extends Schema.Schema.Type<typeof RuntimeCommand> {}
export const PollReply = Schema.Struct({ command: Schema.NullOr(RuntimeCommand) });
export interface PollReply extends Schema.Schema.Type<typeof PollReply> {}
export const ObserveRequest = Schema.Struct({ commandId: Uuid, result: CommandResult });
export interface ObserveRequest extends Schema.Schema.Type<typeof ObserveRequest> {}
export const ObserveReply = Schema.Struct({ acceptedAt: Millis });
export interface ObserveReply extends Schema.Schema.Type<typeof ObserveReply> {}
/**
 * The initiator's GitHub sign-in for git on the box: a user token acting as them within the
 * App's permissions, and the identity their commits carry. null when they never signed in with
 * GitHub. Carried on the wire only; the box keeps it in git's own credential store.
 */
export const LoginReply = Schema.Struct({
  github: Schema.NullOr(
    Schema.Struct({
      token: Schema.NonEmptyString,
      expiresAt: Millis,
      login: Schema.NonEmptyString,
      name: Schema.NonEmptyString,
      email: Schema.NonEmptyString,
    }),
  ),
});
export interface LoginReply extends Schema.Schema.Type<typeof LoginReply> {}

export const Request = Schema.TaggedUnion({
  Assignment: {},
  Enroll: { request: EnrollmentRequest },
  Ready: { request: ReadinessRequest },
  Poll: { request: PollRequest },
  Observe: { request: ObserveRequest },
  Login: {},
});
export type Request = typeof Request.Type;
export type RpcReply<A = unknown> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly reason: Failure["reason"] };

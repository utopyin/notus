import { Enrollment, EpochGrant, Millis, Readiness } from "@notus/executions/types";
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

export const Request = Schema.TaggedUnion({
  Assignment: {},
  Enroll: { request: EnrollmentRequest },
  Ready: { request: ReadinessRequest },
});
export type Request = typeof Request.Type;
export type RpcReply<A = unknown> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly reason: Failure["reason"] };

import { attempts, commands, invocations, outcomes, steps } from "@notus/db/schema/task";
import { Environment } from "@notus/workspaces/types";
import { createSelectSchema } from "drizzle-orm/effect-schema";
import * as Schema from "effect/Schema";
import {
  BlockReason,
  Bootstrap,
  Claim,
  CommandResult,
  CommandSpec,
  Enrollment,
  EpochGrant,
  Millis,
  Observation,
  Phase,
  ReadinessReceipt,
  Resource,
  Work,
} from "./types";

/** Decoders from stored rows to the execution's own types. */
export const Attempt = createSelectSchema(attempts);
export interface Attempt extends Schema.Schema.Type<typeof Attempt> {}

export const Invocation = createSelectSchema(invocations);
export interface Invocation extends Schema.Schema.Type<typeof Invocation> {}

export const Outcome = createSelectSchema(outcomes, { observation: Observation });
export interface Outcome extends Schema.Schema.Type<typeof Outcome> {}

export const Step = createSelectSchema(steps, {
  parts: Schema.NullOr(Schema.Json),
  calls: Schema.NullOr(Schema.Json),
});
export interface Step extends Schema.Schema.Type<typeof Step> {}

export const CommandRow = createSelectSchema(commands, {
  spec: CommandSpec,
  result: Schema.NullOr(CommandResult),
});
export interface CommandRow extends Schema.Schema.Type<typeof CommandRow> {}

/** Private durable state. Public reads project ProvisioningStatus instead. */
export const ProvisioningState = Schema.Struct({
  bootstrap: Bootstrap,
  environment: Schema.NullOr(Environment),
  providerName: Schema.NonEmptyString,
  launchVersion: Schema.Literal(1),
  phase: Phase,
  blockedReason: Schema.NullOr(BlockReason),
  resource: Schema.NullOr(Resource),
  claimGeneration: Millis,
  claim: Schema.NullOr(Claim),
  nextWork: Schema.NullOr(Work),
  dueAt: Schema.NullOr(Millis),
  startupDeadline: Schema.NullOr(Millis),
  activationConfirmed: Schema.Boolean,
  /** An uncertain Activate must be reconciled, never issued again. */
  activationUncertain: Schema.Boolean,
  enrollmentExpected: Schema.Boolean,
  recoveryRevision: Millis,
  runtimeEpoch: Millis,
  startupEpoch: Schema.Int.check(Schema.isGreaterThan(0)),
  enrollment: Schema.NullOr(Enrollment),
  grant: Schema.NullOr(EpochGrant),
  ready: Schema.NullOr(ReadinessReceipt),
  updatedAt: Millis,
  /** Once a replaced attempt's box was ended, or Notus gave up ending it. */
  retiredAt: Schema.optionalKey(Schema.NullOr(Millis)),
  retireFailures: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});
export interface ProvisioningState extends Schema.Schema.Type<typeof ProvisioningState> {}

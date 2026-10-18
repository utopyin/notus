import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

export type RawJson = Schema.Json;

// Protobuf Timestamp's RFC3339 subset: real calendar dates, explicit offset,
// seconds 00..59 (protobuf smears leap seconds), and at most nanosecond precision.
const destroyedAt = Schema.String.check(
  Schema.isPattern(
    /^(?!0000)[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])[Tt](?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]{1,9})?(?:[Zz]|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])$/,
  ),
  Schema.makeFilter((value) => {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = month === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;

    return day <= days;
  }),
);

// Provider observation for one exact old VM, not hardware or current-grant attestation.
export const DestroyedReceipt = Schema.Struct({
  instanceId: Schema.NonEmptyString.check(
    Schema.isMaxLength(256),
    Schema.makeFilter(
      (value) =>
        !Array.from(value).some(
          (char) => /\s/.test(char) || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
        ),
    ),
  ),
  destroyedAt,
});
export interface DestroyedReceipt extends Schema.Schema.Type<typeof DestroyedReceipt> {}

export const Resource = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  instanceId: Schema.optionalKey(Schema.String),
  state: Schema.Literals(["running", "stopped", "expired", "unknown"]),
  readiness: Schema.Literals(["ready", "unknown"]),
  image: Schema.optionalKey(
    Schema.Struct({
      ref: Schema.optionalKey(Schema.String),
      id: Schema.optionalKey(Schema.String),
      name: Schema.optionalKey(Schema.String),
      version: Schema.optionalKey(Schema.Union([Schema.String, Schema.Int])),
    }),
  ),
});
export interface Resource extends Schema.Schema.Type<typeof Resource> {}

export interface RestrictedInput {
  readonly config: RawJson;
  /** Every image the workspace's admins added; the configuration must select one of them. */
  readonly approvedImageRefs: ReadonlyArray<string>;
}

export interface TrustedLaunchInput extends RestrictedInput {
  readonly name: string;
  readonly operationId: string;
  readonly bootstrap: {
    readonly controlUrl: string;
    readonly credential: Redacted.Redacted<string>;
  };
}

export interface RecoveryInput {
  readonly name: string;
  readonly expectedId?: string;
  readonly operationId?: string;
}

export interface Recovery {
  readonly resource: Resource;
  // A matching mutable description is evidence only, never an idempotency guarantee.
  readonly evidence: "matchingPurpose" | "insufficientEvidence" | "purposeMismatch";
}

// No derived provider settings: raw is the only reusable configuration authority.
export interface Configuration {
  readonly raw: Readonly<Record<string, RawJson>>;
}

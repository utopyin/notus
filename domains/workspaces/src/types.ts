import * as Schema from "effect/Schema";

/** Provider-owned JSON, with separate routing metadata. No provider decoding or secret resolution. */
export const Environment = Schema.Struct({
  workspaceId: Schema.NonEmptyString,
  provider: Schema.NonEmptyString,
  config: Schema.Json,
  revision: Schema.Int.check(Schema.isGreaterThan(0)),
});
export interface Environment extends Schema.Schema.Type<typeof Environment> {}

export const Fixture = Schema.Struct({
  workspaceId: Schema.NonEmptyString,
  userId: Schema.NonEmptyString,
  teamId: Schema.NonEmptyString,
  channelId: Schema.NonEmptyString,
});
export interface Fixture extends Schema.Schema.Type<typeof Fixture> {}

export const StartGrant = Schema.Struct({
  workspaceId: Schema.NonEmptyString,
  initiatorId: Schema.NonEmptyString,
});
export interface StartGrant extends Schema.Schema.Type<typeof StartGrant> {}

/** Slack adapter's opaque conversation encoding. Timestamps are never floating-point values. */
export const Conversation = Schema.fromJsonString(
  Schema.Tuple([Schema.NonEmptyString, Schema.String.check(Schema.isPattern(/^\d+\.\d{6}$/))]),
);

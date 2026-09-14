import * as Schema from "effect/Schema";

/** Source systems Notus receives human input from. */
export const SourceKind = Schema.Literals(["slack", "github"]);
export type SourceKind = typeof SourceKind.Type;

export const Actor = Schema.Struct({
  kind: SourceKind,
  installationId: Schema.NonEmptyString,
  externalId: Schema.NonEmptyString,
});
export interface Actor extends Schema.Schema.Type<typeof Actor> {}

/** Opaque conversation address interpreted only by its source adapter. */
export const Source = Schema.Struct({
  kind: SourceKind,
  installationId: Schema.NonEmptyString,
  conversationId: Schema.NonEmptyString,
});
export interface Source extends Schema.Schema.Type<typeof Source> {}

export const ReplyTarget = Schema.Struct({
  source: Source,
  targetId: Schema.NonEmptyString,
});
export interface ReplyTarget extends Schema.Schema.Type<typeof ReplyTarget> {}

/** Source-neutral verified input exchanged by intake, task, and execution owners. */
export const Input = Schema.Struct({
  workspaceId: Schema.NonEmptyString,
  eventId: Schema.NonEmptyString,
  inputId: Schema.NonEmptyString,
  messageKey: Schema.NonEmptyString,
  conversationKey: Schema.NonEmptyString,
  actor: Actor,
  target: ReplyTarget,
  text: Schema.String,
  occurredAt: Schema.NonEmptyString,
  startIntent: Schema.Boolean,
});
export interface Input extends Schema.Schema.Type<typeof Input> {}

export const Reservation = Schema.Struct({
  taskId: Schema.NonEmptyString,
  workspaceId: Schema.NonEmptyString,
  conversationKey: Schema.NonEmptyString,
  initiatorId: Schema.NonEmptyString,
  startInputId: Schema.NonEmptyString,
  startAt: Schema.NonEmptyString,
  source: Source,
});
export interface Reservation extends Schema.Schema.Type<typeof Reservation> {}

export const Admission = Schema.Struct({ reservation: Reservation, input: Input });
export interface Admission extends Schema.Schema.Type<typeof Admission> {}

/** Length-prefix-free tuple encoding avoids ambiguous key concatenation. */
export const key = (...parts: ReadonlyArray<string>): string => JSON.stringify(parts);

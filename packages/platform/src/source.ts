import * as Schema from "effect/Schema";
import { InstallationId, PlatformId } from "./ids";
import { Platform } from "./platform";

export const Actor = Schema.Struct({
  platform: Platform,
  installationId: InstallationId,
  externalId: PlatformId,
});
export interface Actor extends Schema.Schema.Type<typeof Actor> {}

/**
 * A conversation's address. `scope` is the place a workspace authorizes (a channel, a repository)
 * and `conversation` the exchange inside it (a thread, a pull request); both are the adapter's to
 * interpret, so authorization is a lookup on the pair, never a parse.
 */
export const Source = Schema.Struct({
  platform: Platform,
  installationId: InstallationId,
  scope: PlatformId,
  conversation: PlatformId,
});
export interface Source extends Schema.Schema.Type<typeof Source> {}

/** A durable address for answering one input: the message, comment or review it came from. */
export const ReplyTarget = Schema.Struct({ source: Source, target: PlatformId });
export interface ReplyTarget extends Schema.Schema.Type<typeof ReplyTarget> {}

/** A scope the installation can see, for an administrator choosing what a workspace covers. */
export const Scope = Schema.Struct({
  id: PlatformId,
  label: Schema.String,
  /** The app can act there already; elsewhere it must be invited first. */
  member: Schema.Boolean,
  private: Schema.Boolean,
});
export interface Scope extends Schema.Schema.Type<typeof Scope> {}

/** Seconds and six decimals, so inputs from any platform order by plain comparison. */
export const OrderedTimestamp = Schema.String.check(Schema.isPattern(/^\d+\.\d{6}$/));

/** What an adapter produces from one verified delivery, before the host knows the workspace. */
export const Received = Schema.Struct({
  eventId: Schema.NonEmptyString,
  actor: Actor,
  target: ReplyTarget,
  text: Schema.String,
  occurredAt: OrderedTimestamp,
  startIntent: Schema.Boolean,
  /** The conversation's first message. */
  root: Schema.Boolean,
});
export interface Received extends Schema.Schema.Type<typeof Received> {}

/** Source-neutral verified input exchanged by intake, task, and execution owners. */
export const Input = Schema.Struct({
  workspaceId: Schema.NonEmptyString,
  inputId: Schema.NonEmptyString,
  messageKey: Schema.NonEmptyString,
  conversationKey: Schema.NonEmptyString,
  ...Received.fields,
});
export interface Input extends Schema.Schema.Type<typeof Input> {}

export const Reservation = Schema.Struct({
  taskId: Schema.NonEmptyString,
  workspaceId: Schema.NonEmptyString,
  conversationKey: Schema.NonEmptyString,
  initiatorId: Schema.NonEmptyString,
  startInputId: Schema.NonEmptyString,
  startAt: OrderedTimestamp,
  source: Source,
});
export interface Reservation extends Schema.Schema.Type<typeof Reservation> {}

export const Admission = Schema.Struct({ reservation: Reservation, input: Input });
export interface Admission extends Schema.Schema.Type<typeof Admission> {}

/** Length-prefix-free tuple encoding avoids ambiguous key concatenation. */
export const key = (...parts: ReadonlyArray<string>): string => JSON.stringify(parts);

/** Routes are keyed by this; intake and ingress must derive it identically. */
export const conversationKeyOf = (workspaceId: string, source: Source): string =>
  key(workspaceId, source.platform, source.installationId, source.scope, source.conversation);

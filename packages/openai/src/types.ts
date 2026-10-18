import * as Schema from "effect/Schema";

const Millis = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** Subscription login through the Codex backend, or Platform API key billing. */
export const Provider = Schema.Literals(["openai-chatgpt", "openai-api"]);
export type Provider = typeof Provider.Type;

/** A ChatGPT subscription login as the Codex public client issues it. */
export const TokenSet = Schema.Struct({
  access: Schema.NonEmptyString,
  refresh: Schema.NonEmptyString,
  /** Epoch milliseconds. */
  expiresAt: Millis,
  accountId: Schema.NonEmptyString,
  /** The OpenID token Codex reads its plan and account from; absent on older logins. */
  idToken: Schema.optionalKey(Schema.NonEmptyString),
});
export interface TokenSet extends Schema.Schema.Type<typeof TokenSet> {}

/** Development login file shape. */
export const StoredLogin = Schema.Struct({
  access: Schema.NonEmptyString,
  refresh: Schema.NonEmptyString,
  expires: Schema.Finite,
  accountId: Schema.NonEmptyString,
  idToken: Schema.optionalKey(Schema.NonEmptyString),
});
export interface StoredLogin extends Schema.Schema.Type<typeof StoredLogin> {}

/** What a broker forwards on behalf of an authorized caller. No credentials travel here. */
export const ForwardRequest = Schema.Struct({
  method: Schema.Literal("POST"),
  url: Schema.NonEmptyString,
  contentType: Schema.NonEmptyString,
  body: Schema.String,
});
export interface ForwardRequest extends Schema.Schema.Type<typeof ForwardRequest> {}

export const ForwardResponse = Schema.Struct({
  status: Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 599 })),
  contentType: Schema.NullOr(Schema.String),
  /** Provider pacing hint, passed through verbatim so the caller's client can honor it. */
  retryAfter: Schema.NullOr(Schema.String),
  body: Schema.String,
});

/** Definitive provider answers a broker may replay for an identical operation. */
export const replayable = (status: number): boolean =>
  (status >= 200 && status < 300) || [400, 401, 403, 404, 409, 413, 415, 422].includes(status);
export interface ForwardResponse extends Schema.Schema.Type<typeof ForwardResponse> {}

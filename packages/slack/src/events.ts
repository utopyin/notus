import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { InvalidEnvelope, InvalidSignature } from "./errors";

export const Timestamp = Schema.String.check(Schema.isPattern(/^\d+\.\d+$/));
const Header = Schema.Struct({ type: Schema.NonEmptyString });
const Callback = Schema.Struct({
  type: Schema.Literal("event_callback"),
  team_id: Schema.NonEmptyString,
  event_id: Schema.NonEmptyString,
  event: Schema.Struct({
    type: Schema.NonEmptyString,
    subtype: Schema.optionalKey(Schema.String),
    bot_id: Schema.optionalKey(Schema.String),
  }),
});
const Message = Schema.Struct({
  type: Schema.Literals(["app_mention", "message"]),
  channel: Schema.NonEmptyString,
  user: Schema.NonEmptyString,
  text: Schema.String,
  ts: Timestamp,
  thread_ts: Schema.optionalKey(Timestamp),
  team: Schema.optionalKey(Schema.NonEmptyString),
});
export const Event = Schema.Union([
  Schema.Struct({ type: Schema.Literal("url_verification"), challenge: Schema.NonEmptyString }),
  Schema.Struct({
    type: Schema.Literal("event_callback"),
    team_id: Schema.NonEmptyString,
    event_id: Schema.NonEmptyString,
    event: Message,
  }),
  Schema.Struct({ type: Schema.Literal("ignored") }),
]);
export type Event = typeof Event.Type;

/** Decode only after verify succeeds. Unknown event kinds and bot/subtype events are ignored. */
export const decode = Effect.fn("Slack.decode")(function* (
  rawBody: Uint8Array,
): Effect.fn.Return<Event, InvalidEnvelope> {
  const text = yield* Effect.try({
    try: () => new TextDecoder("utf-8", { fatal: true }).decode(rawBody),
    catch: () => new InvalidEnvelope({}),
  });
  const value = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(text).pipe(
    Effect.mapError(() => new InvalidEnvelope({})),
  );
  const header = yield* Schema.decodeUnknownEffect(Header)(value).pipe(
    Effect.mapError(() => new InvalidEnvelope({})),
  );
  if (header.type === "url_verification") {
    return yield* Schema.decodeUnknownEffect(Event)(value).pipe(
      Effect.mapError(() => new InvalidEnvelope({})),
    );
  }
  if (header.type !== "event_callback") return { type: "ignored" };
  const callback = yield* Schema.decodeUnknownEffect(Callback)(value).pipe(
    Effect.mapError(() => new InvalidEnvelope({})),
  );
  if (
    callback.event.subtype !== undefined ||
    callback.event.bot_id !== undefined ||
    (callback.event.type !== "app_mention" && callback.event.type !== "message")
  )
    return { type: "ignored" };
  return yield* Schema.decodeUnknownEffect(Event)(value).pipe(
    Effect.mapError(() => new InvalidEnvelope({})),
  );
});

/** Verify untouched request bytes with Web Crypto's constant-time HMAC verification. */
export const verify = Effect.fn("Slack.verify")(function* (
  rawBody: Uint8Array,
  timestamp: string | null,
  signature: string | null,
  signingSecret: Redacted.Redacted<string>,
): Effect.fn.Return<void, InvalidSignature> {
  const now = yield* Clock.currentTimeMillis;
  if (
    timestamp === null ||
    signature === null ||
    !/^\d+$/.test(timestamp) ||
    !/^v0=[a-f0-9]{64}$/.test(signature) ||
    !Number.isSafeInteger(Number(timestamp)) ||
    Math.abs(now / 1000 - Number(timestamp)) > 300
  )
    return yield* new InvalidSignature({});
  const prefix = new TextEncoder().encode(`v0:${timestamp}:`);
  const bytes = new Uint8Array(prefix.length + rawBody.length);
  bytes.set(prefix);
  bytes.set(rawBody, prefix.length);
  const digest = new Uint8Array(32);
  for (let i = 0; i < digest.length; i++)
    digest[i] = Number.parseInt(signature.slice(3 + i * 2, 5 + i * 2), 16);
  const key = yield* Effect.tryPromise({
    try: () =>
      crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(Redacted.value(signingSecret)),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"],
      ),
    catch: () => new InvalidSignature({}),
  });
  const valid = yield* Effect.tryPromise({
    try: () => crypto.subtle.verify("HMAC", key, digest, bytes),
    catch: () => new InvalidSignature({}),
  });
  if (!valid) return yield* new InvalidSignature({});
});

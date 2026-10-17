import { Credentials, DEFAULT_API_BASE_URL } from "@distilled.cloud/slack/Credentials";
import * as Errors from "@distilled.cloud/slack/Errors";
import * as Retry from "@distilled.cloud/slack/Retry";
import { postMessage } from "@distilled.cloud/slack/chat";
import { listConversations } from "@distilled.cloud/slack/conversations";
import { addReaction } from "@distilled.cloud/slack/reactions";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientError from "effect/http/HttpClientError";
import { DeliveryError } from "./errors";
import { Timestamp } from "./events";

export class Configuration extends Context.Service<
  Configuration,
  { readonly token: Redacted.Redacted<string> }
>()("@notus/slack/Configuration") {}

export const Receipt = Schema.Struct({
  channel: Schema.NonEmptyString,
  ts: Schema.NonEmptyString,
  deliveryId: Schema.optionalKey(Schema.NonEmptyString),
});
export interface Receipt extends Schema.Schema.Type<typeof Receipt> {}
export const ChannelSummary = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.String,
  isMember: Schema.Boolean,
  isPrivate: Schema.Boolean,
});
export interface ChannelSummary extends Schema.Schema.Type<typeof ChannelSummary> {}
export interface Interface {
  readonly react: (channel: string, ts: string) => Effect.Effect<Receipt, DeliveryError>;
  /** Channels of the installed team, for an administrator choosing which ones a workspace covers. */
  readonly listChannels: Effect.Effect<ReadonlyArray<ChannelSummary>, DeliveryError>;
  readonly reply: (
    channel: string,
    threadTs: string,
    text: string,
    deliveryId: string,
  ) => Effect.Effect<Receipt, DeliveryError>;
}
export class Service extends Context.Service<Service, Interface>()("@notus/slack/Service") {}

const rejected = () => new DeliveryError({ classification: "rejected" });
const ambiguous = () => new DeliveryError({ classification: "ambiguous" });
const classify = (error: unknown): DeliveryError => {
  if (HttpClientError.isHttpClientError(error) && error.response?.status === 429) {
    // Slack specifies Retry-After in seconds. Invalid/missing hints use the
    // same conservative fallback as SDK rate limits, without reading the body.
    const header = error.response.headers["retry-after"];
    const delay =
      header !== undefined && /^\d+(?:\.\d+)?$/.test(header.trim()) ? Number(header) * 1000 : NaN;
    return new DeliveryError({
      classification: "rate-limited",
      retryAfter: Number.isFinite(delay) ? delay : 60_000,
    });
  }
  if (Schema.is(Errors.SlackRateLimited)(error)) {
    const delay = error.retryAfter === undefined ? 60_000 : Duration.toMillis(error.retryAfter);
    return new DeliveryError({
      classification: "rate-limited",
      retryAfter: Number.isFinite(delay) && delay >= 0 ? delay : 60_000,
    });
  }
  if (
    Schema.is(Errors.Unauthorized)(error) ||
    Schema.is(Errors.Forbidden)(error) ||
    Schema.is(Errors.BadRequest)(error) ||
    Schema.is(Errors.NotFound)(error) ||
    Schema.is(Errors.UnprocessableEntity)(error)
  )
    return rejected();
  // Only documented pre-send rejection slugs are safe to classify as not sent.
  if (
    Schema.is(Errors.SlackError)(error) &&
    new Set([
      "channel_not_found",
      "not_in_channel",
      "is_archived",
      "missing_scope",
      "no_permission",
      "access_denied",
      "invalid_arguments",
      "invalid_arg_name",
      "invalid_timestamp",
      "message_not_found",
      "no_text",
      "msg_too_long",
      "restricted_action",
      "ekm_access_denied",
      "cannot_reply_to_message",
      "too_many_attachments",
      "invalid_name",
      "no_reaction",
    ]).has(error.code)
  )
    return rejected();
  return ambiguous();
};

/** A client for one bot token: what an installation's operations run through. */
export const make = (token: Redacted.Redacted<string>) =>
  Effect.gen(function* () {
    const config = { token };
    // Distilled reads the body with orDie before checking status. Reject 429
    // here so a broken or stalled body cannot erase known rate-limit evidence.
    const http = (yield* HttpClient.HttpClient).pipe(
      HttpClient.filterStatus((status) => status !== 429),
    );
    const credentials = Effect.succeed({ token: config.token, apiBaseUrl: DEFAULT_API_BASE_URL });
    const run = <A, E>(operation: Effect.Effect<A, E, Credentials | HttpClient.HttpClient>) =>
      operation.pipe(
        Retry.none,
        Effect.provideService(Credentials, credentials),
        Effect.provideService(HttpClient.HttpClient, http),
        // Bound transport AND SDK body decoding for replies and reactions. A
        // timed-out mutation may have succeeded; it must never trigger a retry.
        Effect.timeout("10 seconds"),
        Effect.mapError(classify),
        // Distilled's response reader currently promotes body-read failures to defects.
        // A broken response may follow a successful mutation. Never retry it here.
        Effect.catchDefect(() => Effect.fail(ambiguous())),
      );
    const validate = (channel: string, ts: string) =>
      channel.length > 0 && Schema.is(Timestamp)(ts);
    const ChannelItem = Schema.Struct({
      id: Schema.NonEmptyString,
      name: Schema.optionalKey(Schema.String),
      is_member: Schema.optionalKey(Schema.Boolean),
      is_private: Schema.optionalKey(Schema.Boolean),
      is_archived: Schema.optionalKey(Schema.Boolean),
    });
    const listChannels = Effect.gen(function* () {
      const result = yield* run(
        listConversations({
          types: "public_channel,private_channel",
          exclude_archived: true,
          limit: 1000,
        }),
      );
      if (!result.ok) return yield* ambiguous();
      const channels: Array<ChannelSummary> = [];
      for (const item of result.channels) {
        const decoded = yield* Schema.decodeUnknownEffect(ChannelItem)(item).pipe(Effect.option);
        if (decoded._tag === "None" || decoded.value.is_archived === true) continue;
        channels.push({
          id: decoded.value.id,
          name: decoded.value.name ?? decoded.value.id,
          isMember: decoded.value.is_member ?? false,
          isPrivate: decoded.value.is_private ?? false,
        });
      }
      return channels.sort((a, b) => a.name.localeCompare(b.name));
    }).pipe(Effect.withSpan("Slack.listChannels"));
    return {
      listChannels,
      react: Effect.fn("Slack.react")(function* (channel, ts) {
        if (!validate(channel, ts)) return yield* rejected();
        const result = yield* run(
          addReaction({ channel, timestamp: ts, name: "eyes" }).pipe(
            Effect.catchIf(
              (error) => Schema.is(Errors.SlackError)(error) && error.code === "already_reacted",
              () => Effect.succeed({ ok: true }),
            ),
          ),
        );
        if (!result.ok) return yield* ambiguous();
        return { channel, ts };
      }),
      reply: Effect.fn("Slack.reply")(function* (channel, threadTs, text, deliveryId) {
        if (
          !validate(channel, threadTs) ||
          !deliveryId ||
          !text.trim() ||
          /@(?:here|channel|everyone)\b|<!(?:here|channel|everyone)\b/i.test(text)
        )
          return yield* rejected();
        const result = yield* run(
          postMessage({
            channel,
            thread_ts: threadTs,
            text,
            unfurl_links: false,
            unfurl_media: false,
            parse: "none",
            mrkdwn: false,
            link_names: false,
            reply_broadcast: false,
          }),
        );
        if (!result.ok || result.channel !== channel || !Schema.is(Timestamp)(result.ts))
          return yield* ambiguous();
        return { channel: result.channel, ts: result.ts, deliveryId };
      }),
    } satisfies Interface;
  });
export const layerNoDeps = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Configuration;
    return Service.of(yield* make(config.token));
  }),
);
export const layer = layerNoDeps.pipe(Layer.provide(FetchHttpClient.layer));
export * as Slack from "./service";

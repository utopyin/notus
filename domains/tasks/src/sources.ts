import { Input, ReplyTarget, Source, key } from "@notus/contracts/source";
import type { Event } from "@notus/slack/events";
import { Timestamp } from "@notus/slack/events";
import { Slack } from "@notus/slack/service";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { SourceError } from "./source-errors";

export const Configuration = Schema.Struct({
  workspaceId: Schema.NonEmptyString,
  teamId: Schema.NonEmptyString,
  channelId: Schema.NonEmptyString,
  botUserId: Schema.NonEmptyString,
});
export interface Configuration extends Schema.Schema.Type<typeof Configuration> {}
export class ConfigurationService extends Context.Service<ConfigurationService, Configuration>()(
  "@notus/tasks/Sources.Configuration",
) {}

export type Normalized =
  | { readonly type: "input"; readonly input: Input }
  | { readonly type: "ignored" }
  | { readonly type: "challenge"; readonly challenge: string };

/** The installation ID is the configured Slack team ID for this slice. */
export const normalize = (envelope: Event, configuration: Configuration): Normalized => {
  if (envelope.type === "url_verification")
    return { type: "challenge", challenge: envelope.challenge };
  if (envelope.type === "ignored") return { type: "ignored" };
  const event = envelope.event;
  if (
    envelope.team_id !== configuration.teamId ||
    event.channel !== configuration.channelId ||
    event.user === configuration.botUserId ||
    (event.team !== undefined && event.team !== configuration.teamId)
  )
    return { type: "ignored" };
  const rootTs = event.thread_ts ?? event.ts;
  const messageKey = key(configuration.teamId, event.channel, event.ts);
  return {
    type: "input",
    input: {
      workspaceId: configuration.workspaceId,
      eventId: key(configuration.teamId, envelope.event_id),
      inputId: messageKey,
      messageKey,
      conversationKey: key(configuration.workspaceId, configuration.teamId, event.channel, rootTs),
      actor: { kind: "slack", installationId: configuration.teamId, externalId: event.user },
      target: {
        source: {
          kind: "slack",
          installationId: configuration.teamId,
          conversationId: key(event.channel, rootTs),
        },
        targetId: event.ts,
      },
      text: event.text,
      occurredAt: event.ts,
      startIntent:
        event.type === "app_mention" || event.text.includes(`<@${configuration.botUserId}>`),
    },
  };
};

export const Receipt = Schema.Struct({
  reference: Schema.NonEmptyString,
  deliveryId: Schema.NonEmptyString,
});
export interface Receipt extends Schema.Schema.Type<typeof Receipt> {}
/** Runtime-only handles. Persist ReplyTarget, never these closures. */
export interface ReplyHandle {
  readonly react: (deliveryId: string) => Effect.Effect<Receipt, SourceError>;
  readonly reply: (text: string, deliveryId: string) => Effect.Effect<Receipt, SourceError>;
}
export interface UpdateHandle {
  readonly send: (text: string, deliveryId: string) => Effect.Effect<Receipt, SourceError>;
}
export interface Interface {
  readonly resolveReply: (target: ReplyTarget) => Effect.Effect<ReplyHandle, SourceError>;
  /** origin must be the task's persisted immutable origin, not an incoming source. */
  readonly resolveUpdates: (
    origin: Source,
    target: Source,
  ) => Effect.Effect<UpdateHandle, SourceError>;
}
export class Service extends Context.Service<Service, Interface>()(
  "@notus/tasks/Sources.Service",
) {}
const unsupported = () => new SourceError({ classification: "unsupported" });
const Address = Schema.Tuple([Schema.NonEmptyString, Timestamp]);

export const layerNoDeps = Layer.effect(
  Service,
  Effect.gen(function* () {
    const slack = yield* Slack.Service;
    const configuration = yield* ConfigurationService;
    const address = Effect.fn("Sources.address")(function* (source: Source) {
      const validated = yield* Schema.decodeEffect(Source)(source).pipe(
        Effect.mapError(unsupported),
      );
      if (validated.installationId !== configuration.teamId) return yield* unsupported();
      const tuple = yield* Schema.decodeEffect(Schema.fromJsonString(Address))(
        validated.conversationId,
      ).pipe(Effect.mapError(unsupported));
      if (tuple[0] !== configuration.channelId) return yield* unsupported();
      return tuple;
    });
    const deliver = <A>(
      effect: Effect.Effect<
        A,
        {
          readonly classification: "rate-limited" | "rejected" | "ambiguous";
          readonly retryAfter?: number;
        }
      >,
    ) =>
      effect.pipe(
        Effect.mapError(
          (error) =>
            new SourceError({
              classification: error.classification,
              ...(error.retryAfter === undefined ? {} : { retryAfter: error.retryAfter }),
            }),
        ),
      );
    const resolveReply = Effect.fn("Sources.resolveReply")(function* (
      target: ReplyTarget,
    ): Effect.fn.Return<ReplyHandle, SourceError> {
      const validated = yield* Schema.decodeEffect(ReplyTarget)(target).pipe(
        Effect.mapError(unsupported),
      );
      const [channel, rootTs] = yield* address(validated.source);
      if (!Schema.is(Timestamp)(validated.targetId)) return yield* unsupported();
      return {
        react: Effect.fn("Sources.react")(function* (deliveryId) {
          if (!deliveryId) return yield* unsupported();
          const receipt = yield* deliver(slack.react(channel, validated.targetId));
          return { reference: key(receipt.channel, receipt.ts, "eyes"), deliveryId };
        }),
        reply: Effect.fn("Sources.reply")(function* (text, deliveryId) {
          const receipt = yield* deliver(slack.reply(channel, rootTs, text, deliveryId));
          return { reference: key(receipt.channel, receipt.ts), deliveryId };
        }),
      };
    });
    return Service.of({
      resolveReply,
      resolveUpdates: Effect.fn("Sources.resolveUpdates")(function* (origin, target) {
        const [, rootTs] = yield* address(origin);
        yield* address(target);
        if (
          origin.kind !== target.kind ||
          origin.installationId !== target.installationId ||
          origin.conversationId !== target.conversationId
        )
          return yield* unsupported();
        const handle = yield* resolveReply({ source: origin, targetId: rootTs });
        return { send: handle.reply };
      }),
    });
  }),
);
export const layer = layerNoDeps.pipe(Layer.provide(Slack.layer));
export * as Sources from "./sources";

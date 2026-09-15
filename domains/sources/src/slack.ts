import type { InstallationSurfaces, PlatformAdapter, ReplyHandle } from "@notus/platform/adapter";
import { SLACK_DESCRIPTOR } from "@notus/platform/descriptors/slack";
import { IngressError, InstallationNotFound, SourceError } from "@notus/platform/errors";
import type { InstallationRef } from "@notus/platform/ids";
import type { IngressRequest, Normalized } from "@notus/platform/ingress";
import { key, Received, ReplyTarget, Scope, Source } from "@notus/platform/source";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Events from "@notus/slack/events";
import { Slack } from "@notus/slack/service";

/** The one team this deployment is installed in, until installations are workspace data. */
export class Configuration extends Context.Service<
  Configuration,
  {
    readonly teamId: string;
    readonly botUserId: string;
    readonly signingSecret: Redacted.Redacted<string>;
  }
>()("@notus/slack/Adapter.Configuration") {}

const unsupported = () => new SourceError({ classification: "unsupported" });
const ingressError = (reason: IngressError["reason"]) =>
  new IngressError({ platform: "slack", reason });

/**
 * Slack as a source. A channel is the scope, a thread (its root timestamp) the conversation and a
 * message timestamp the reply target; only this file reads or writes those shapes.
 */
export const adapter: Effect.Effect<PlatformAdapter, never, Configuration | Slack.Service> =
  Effect.gen(function* () {
    const configuration = yield* Configuration;
    const slack = yield* Slack.Service;

    const receive = Effect.fn("Slack.receive")(function* (
      request: IngressRequest,
    ): Effect.fn.Return<Normalized, IngressError> {
      yield* Events.verify(
        request.body,
        request.header("x-slack-request-timestamp"),
        request.header("x-slack-signature"),
        configuration.signingSecret,
      ).pipe(Effect.mapError(() => ingressError("signature")));
      const envelope = yield* Events.decode(request.body).pipe(
        Effect.mapError(() => ingressError("envelope")),
      );
      if (envelope.type === "url_verification")
        return { type: "acknowledge", body: { challenge: envelope.challenge } };
      if (envelope.type === "ignored") return { type: "ignored", reason: "event" };
      const event = envelope.event;
      if (
        envelope.team_id !== configuration.teamId ||
        (event.team !== undefined && event.team !== configuration.teamId)
      )
        return { type: "ignored", reason: "foreign-team" };
      if (event.user === configuration.botUserId) return { type: "ignored", reason: "self" };
      const rootTs = event.thread_ts ?? event.ts;
      const received = yield* Schema.decodeEffect(Received)({
        eventId: key(envelope.team_id, envelope.event_id),
        actor: { platform: "slack", installationId: envelope.team_id, externalId: event.user },
        target: {
          source: {
            platform: "slack",
            installationId: envelope.team_id,
            scope: event.channel,
            conversation: rootTs,
          },
          target: event.ts,
        },
        text: event.text,
        occurredAt: event.ts,
        startIntent:
          event.type === "app_mention" || event.text.includes(`<@${configuration.botUserId}>`),
        root: rootTs === event.ts,
      }).pipe(Effect.mapError(() => ingressError("envelope")));
      return { type: "input", received, claim: null };
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
    const resolveReply = Effect.fn("Slack.resolveReply")(function* (
      target: ReplyTarget,
    ): Effect.fn.Return<ReplyHandle, SourceError> {
      const validated = yield* Schema.decodeEffect(ReplyTarget)(target).pipe(
        Effect.mapError(unsupported),
      );
      if (
        validated.source.platform !== "slack" ||
        validated.source.installationId !== configuration.teamId ||
        !Schema.is(Events.Timestamp)(validated.source.conversation) ||
        !Schema.is(Events.Timestamp)(validated.target)
      )
        return yield* unsupported();
      const channel = validated.source.scope;
      const rootTs = validated.source.conversation;
      return {
        react: Effect.fn("Slack.react")(function* (deliveryId) {
          if (!deliveryId) return yield* unsupported();
          const receipt = yield* deliver(slack.react(channel, validated.target));
          return { reference: key(receipt.channel, receipt.ts, "eyes"), deliveryId };
        }),
        reply: Effect.fn("Slack.reply")(function* (text, deliveryId) {
          const receipt = yield* deliver(slack.reply(channel, rootTs, text, deliveryId));
          return { reference: key(receipt.channel, receipt.ts), deliveryId };
        }),
      };
    });
    const surfaces: InstallationSurfaces = {
      scopes: {
        list: slack.listChannels.pipe(
          Effect.map((channels) =>
            channels.map((channel) => ({
              id: channel.id,
              label: channel.name,
              member: channel.isMember,
              private: channel.isPrivate,
            })),
          ),
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Scope))),
          Effect.mapError((error) =>
            Schema.is(SourceError)(error) ? error : new SourceError({ classification: "rejected" }),
          ),
        ),
      },
      conversations: {
        resolveReply,
        resolveUpdates: Effect.fn("Slack.resolveUpdates")(function* (origin, target) {
          const source = yield* Schema.decodeEffect(Source)(origin).pipe(
            Effect.mapError(unsupported),
          );
          if (
            source.platform !== target.platform ||
            source.installationId !== target.installationId ||
            source.scope !== target.scope ||
            source.conversation !== target.conversation
          )
            return yield* unsupported();
          const handle = yield* resolveReply({ source, target: source.conversation });
          return { send: handle.reply };
        }),
      },
      // Posting in a channel the app is in is participation enough; membership is authorized elsewhere.
      identity: { mayParticipate: () => Effect.succeed(true) },
    };
    return {
      platform: "slack",
      descriptor: SLACK_DESCRIPTOR,
      ingress: { receive },
      forInstallation: (ref: InstallationRef) =>
        ref.installationId === configuration.teamId
          ? Effect.succeed(surfaces)
          : Effect.fail(new InstallationNotFound(ref)),
    };
  });

export * as SlackAdapter from "./slack";

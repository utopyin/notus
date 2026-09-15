import type { InstallationSurfaces, PlatformAdapter, ReplyHandle } from "@notus/platform/adapter";
import { InstallationCredentials } from "@notus/platform/credentials";
import { SLACK_DESCRIPTOR } from "@notus/platform/descriptors/slack";
import { IngressError, InstallationNotFound, SourceError } from "@notus/platform/errors";
import { InstallationId, type InstallationRef } from "@notus/platform/ids";
import type { IngressRequest, Normalized } from "@notus/platform/ingress";
import { InstallError, type PlatformInstalling } from "@notus/platform/installing";
import { key, Received, ReplyTarget, Scope, Source } from "@notus/platform/source";
import * as Events from "@notus/slack/events";
import { OAuth } from "@notus/slack/oauth";
import { Slack } from "@notus/slack/service";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/unstable/http/HttpClient";

/** The Slack app itself: one signing secret and one OAuth client for every team it is installed in. */
export class Configuration extends Context.Service<
  Configuration,
  {
    readonly signingSecret: Redacted.Redacted<string>;
    /** Absent when this deployment cannot install: the dashboard then offers no "Add to Slack". */
    readonly oauth: {
      readonly clientId: string;
      readonly clientSecret: Redacted.Redacted<string>;
    } | null;
  }
>()("@notus/platform-slack/Configuration") {}

/** What an installation stored when the app was added to its team. Decoded here and nowhere else. */
const Credential = Schema.Struct({
  botToken: Schema.NonEmptyString,
  botUserId: Schema.NonEmptyString,
});

const unsupported = () => new SourceError({ classification: "unsupported" });
const ingressError = (reason: IngressError["reason"]) =>
  new IngressError({ platform: "slack", reason });

/**
 * Slack as a platform. A channel is the scope, a thread (its root timestamp) the conversation and
 * a message timestamp the reply target; only this file reads or writes those shapes.
 */
export const adapter: Effect.Effect<
  PlatformAdapter,
  never,
  Configuration | InstallationCredentials | HttpClient.HttpClient
> = Effect.gen(function* () {
  const configuration = yield* Configuration;
  const credentials = yield* InstallationCredentials;
  const http = yield* HttpClient.HttpClient;

  /** The team's credential, or none when the app was never added there. */
  const credentialOf = (teamId: string) =>
    credentials.get({ platform: "slack", installationId: InstallationId.make(teamId) }).pipe(
      Effect.flatMap((stored) =>
        Option.isNone(stored)
          ? Effect.succeed(Option.none<typeof Credential.Type>())
          : Schema.decodeUnknownEffect(Credential)(stored.value).pipe(Effect.option),
      ),
      Effect.orElseSucceed(() => Option.none<typeof Credential.Type>()),
    );

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
    if (event.team !== undefined && event.team !== envelope.team_id)
      return { type: "ignored", reason: "foreign-team" };
    // The bot's own messages must never start another round; the team's credential names it.
    const credential = yield* credentialOf(envelope.team_id);
    if (Option.isNone(credential)) return { type: "ignored", reason: "unknown-team" };
    if (event.user === credential.value.botUserId) return { type: "ignored", reason: "self" };
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
        event.type === "app_mention" || event.text.includes(`<@${credential.value.botUserId}>`),
      root: rootTs === event.ts,
    }).pipe(Effect.mapError(() => ingressError("envelope")));
    return { type: "input", received, claim: null };
  });

  const installing: PlatformInstalling = {
    begin: (intent) =>
      configuration.oauth === null
        ? Effect.fail(new InstallError({ platform: "slack", reason: "unconfigured" }))
        : Effect.succeed({
            url: OAuth.authorizeUrl({
              clientId: configuration.oauth.clientId,
              redirectUri: intent.redirectUri,
              state: intent.state,
            }),
          }),
    complete: Effect.fn("Slack.install")(function* (intent, query) {
      if (configuration.oauth === null)
        return yield* new InstallError({ platform: "slack", reason: "unconfigured" });
      const code = query.get("code");
      if (!code) return yield* new InstallError({ platform: "slack", reason: "rejected" });
      const grant = yield* OAuth.exchange({
        clientId: configuration.oauth.clientId,
        clientSecret: configuration.oauth.clientSecret,
        code,
        redirectUri: intent.redirectUri,
      }).pipe(
        Effect.provideService(HttpClient.HttpClient, http),
        Effect.mapError((error) => new InstallError({ platform: "slack", reason: error.reason })),
      );
      return {
        installationId: grant.teamId,
        label: grant.teamName,
        credential: { botToken: grant.botToken, botUserId: grant.botUserId },
      };
    }),
  };

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
  /** The surfaces for one team, over a client holding that team's bot token. */
  const surfacesOf = (teamId: string, slack: Slack.Interface): InstallationSurfaces => {
    const resolveReply = Effect.fn("Slack.resolveReply")(function* (
      target: ReplyTarget,
    ): Effect.fn.Return<ReplyHandle, SourceError> {
      const validated = yield* Schema.decodeEffect(ReplyTarget)(target).pipe(
        Effect.mapError(unsupported),
      );
      if (
        validated.source.platform !== "slack" ||
        validated.source.installationId !== teamId ||
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
    return {
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
  };
  return {
    platform: "slack",
    descriptor: SLACK_DESCRIPTOR,
    ingress: { receive },
    installing,
    forInstallation: (ref: InstallationRef) =>
      Effect.gen(function* () {
        const credential = yield* credentialOf(ref.installationId);
        if (Option.isNone(credential)) return yield* new InstallationNotFound(ref);
        const slack = yield* Slack.make(Redacted.make(credential.value.botToken)).pipe(
          Effect.provideService(HttpClient.HttpClient, http),
        );
        return surfacesOf(ref.installationId, slack);
      }),
  };
});

export * as SlackAdapter from "./adapter";

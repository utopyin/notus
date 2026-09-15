import type { InstallationSurfaces, PlatformAdapter, ReplyHandle } from "@notus/sources/adapter";
import { CapabilityNotSupportedError } from "@notus/sources/capabilities";
import { GITHUB_DESCRIPTOR } from "@notus/sources/descriptors/github";
import { IngressError, InstallationNotFound, SourceError } from "@notus/sources/errors";
import type { InstallationRef, PlatformId } from "@notus/sources/ids";
import type { IngressRequest, Normalized } from "@notus/sources/ingress";
import { key, Received, ReplyTarget, type Actor } from "@notus/sources/source";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { App } from "./app";
import type { AppError } from "./errors";
import { Role } from "./app";
import { Webhooks } from "./webhooks";

/** The one App installation this deployment answers for, until installations are workspace data. */
export class Configuration extends Context.Service<
  Configuration,
  {
    readonly installationId: string | null;
    readonly webhookSecret: Redacted.Redacted<string> | null;
  }
>()("@notus/github/Adapter.Configuration") {}

const unsupported = () => new SourceError({ classification: "unsupported" });
const ingressError = (reason: IngressError["reason"]) =>
  new IngressError({ platform: "github", reason });
/** A timed-out or undecodable write may have landed, so it is ambiguous, never retried blindly. */
const sourceError = (error: AppError) =>
  new SourceError({
    classification:
      error.reason === "configuration"
        ? "unsupported"
        : error.reason === "rejected"
          ? error.status === 429
            ? "rate-limited"
            : "rejected"
          : "ambiguous",
  });
/** A repository scope, "owner/name", as only this adapter spells it. */
const Segment = /^[A-Za-z0-9._-]{1,100}$/;
const repositoryOf = (scope: string) =>
  Effect.gen(function* () {
    const [owner, name, ...rest] = scope.split("/");
    if (rest.length > 0 || !owner || !name || !Segment.test(owner) || !Segment.test(name))
      return yield* unsupported();
    return { owner, name };
  });
const PullNumber = Schema.String.check(Schema.isPattern(/^[1-9]\d{0,9}$/));
const PullTarget = Schema.fromJsonString(
  Schema.Tuple([Webhooks.TargetKind, Schema.String.check(Schema.isPattern(/^\d{1,20}$/))]),
);
const writers = new Set<Role>(["admin", "maintain", "write"]);

/**
 * GitHub as a source. A repository is the scope, a pull request number the conversation, and a
 * comment or review the reply target; only this file reads or writes those shapes.
 */
export const adapter: Effect.Effect<PlatformAdapter, never, Configuration | App.Service> =
  Effect.gen(function* () {
    const configuration = yield* Configuration;
    const app = yield* App.Service;

    const receive = Effect.fn("GitHub.receive")(function* (
      request: IngressRequest,
    ): Effect.fn.Return<Normalized, IngressError> {
      if (configuration.webhookSecret === null) return yield* ingressError("unconfigured");
      yield* Webhooks.verify(
        request.body,
        request.header("x-hub-signature-256"),
        configuration.webhookSecret,
      ).pipe(Effect.mapError(() => ingressError("signature")));
      const decoded = yield* Webhooks.decode(
        request.header("x-github-event"),
        request.header("x-github-delivery"),
        request.body,
      ).pipe(Effect.mapError(() => ingressError("envelope")));
      if (decoded.type === "ping") return { type: "ignored", reason: "ping" };
      if (decoded.type === "ignored") return { type: "ignored", reason: decoded.reason };
      const feedback = decoded.feedback;
      if (feedback.installationId !== configuration.installationId)
        return { type: "ignored", reason: "foreign-installation" };
      // Notus's own comments, and any bot or app, must never start another round.
      if (
        feedback.author.type === "Bot" ||
        feedback.author.login.endsWith("[bot]") ||
        feedback.viaAppId !== null
      )
        return { type: "ignored", reason: "bot" };
      const occurredAt = Webhooks.orderedTimestamp(feedback.createdAt);
      if (occurredAt === null) return yield* ingressError("envelope");
      const received = yield* Schema.decodeEffect(Received)({
        eventId: key(feedback.installationId, feedback.deliveryId),
        actor: {
          platform: "github",
          installationId: feedback.installationId,
          externalId: feedback.author.login,
        },
        target: {
          source: {
            platform: "github",
            installationId: feedback.installationId,
            scope: `${feedback.repository.owner}/${feedback.repository.name}`,
            conversation: String(feedback.pullNumber),
          },
          target: key(feedback.target.kind, feedback.target.id),
        },
        // A review comment is about one line; the operator needs that anchor to change the right code.
        text:
          feedback.location === null
            ? feedback.body
            : `Review comment on ${feedback.location.path}${feedback.location.line === null ? "" : ` line ${feedback.location.line}`} (line numbers refer to the pull request branch):\n${feedback.body}`,
        occurredAt,
        // Pull request feedback never starts a task, and a pull request is never its own first message.
        startIntent: false,
        root: false,
      }).pipe(Effect.mapError(() => ingressError("envelope")));
      const taskId = Webhooks.markedTask(feedback.pullBody);
      return { type: "input", received, claim: taskId === null ? null : { taskId } };
    });

    const resolveReply = Effect.fn("GitHub.resolveReply")(function* (
      target: ReplyTarget,
    ): Effect.fn.Return<ReplyHandle, SourceError> {
      const validated = yield* Schema.decodeEffect(ReplyTarget)(target).pipe(
        Effect.mapError(unsupported),
      );
      if (
        validated.source.platform !== "github" ||
        validated.source.installationId !== configuration.installationId
      )
        return yield* unsupported();
      const repository = yield* repositoryOf(validated.source.scope);
      const number = yield* Schema.decodeEffect(PullNumber)(validated.source.conversation).pipe(
        Effect.mapError(unsupported),
      );
      const [kind, id] = yield* Schema.decodeEffect(PullTarget)(validated.target).pipe(
        Effect.mapError(unsupported),
      );
      const pullNumber = Number(number);
      return {
        react: Effect.fn("GitHub.react")(function* (deliveryId) {
          // Reviews themselves cannot carry reactions on GitHub; the answer still follows.
          if (!deliveryId || kind === "review") return yield* unsupported();
          yield* app.react(repository, { kind, commentId: id }).pipe(Effect.mapError(sourceError));
          return { reference: key("github-reaction", kind, id), deliveryId };
        }),
        reply: Effect.fn("GitHub.reply")(function* (text, deliveryId) {
          const posted =
            kind === "review-comment"
              ? yield* app.replyToReviewComment(repository, {
                  pullNumber,
                  commentId: id,
                  body: text,
                })
              : yield* app.comment(repository, { pullNumber, body: text });
          return { reference: key("github-comment", posted.id), deliveryId };
        }, Effect.mapError(sourceError)),
      };
    });
    const mayParticipate = Effect.fn("GitHub.mayParticipate")(function* (
      actor: Actor,
      scope: PlatformId,
    ) {
      const repository = yield* repositoryOf(scope);
      // Only collaborators with write access may steer a task through its pull request.
      const role = yield* app
        .collaboratorRole(repository, actor.externalId)
        .pipe(Effect.mapError(sourceError));
      return writers.has(role);
    });
    const surfaces: InstallationSurfaces = {
      scopes: {
        list: Effect.fail(
          new CapabilityNotSupportedError({ platform: "github", capability: "scope:list" }),
        ),
      },
      conversations: {
        resolveReply,
        // A pull request receives replies to its feedback, never the task's running updates.
        resolveUpdates: () => Effect.fail(unsupported()),
      },
      identity: { mayParticipate },
    };
    return {
      platform: "github",
      descriptor: GITHUB_DESCRIPTOR,
      ingress: { receive },
      forInstallation: (ref: InstallationRef) =>
        configuration.installationId !== null && ref.installationId === configuration.installationId
          ? Effect.succeed(surfaces)
          : Effect.fail(new InstallationNotFound(ref)),
    };
  });

export * as GithubAdapter from "./adapter";

import { key, type Input, type Reservation, type Source } from "@notus/contracts/source";
import { githubConversationKey } from "@notus/control/inbox";
import type { Role } from "@notus/github/app";
import { Webhooks } from "@notus/github/webhooks";
import * as Effect from "effect/Effect";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

/** A dependency failed; the delivery could not be recorded and GitHub is told so with 503. */
export class IngressFailure extends Schema.TaggedError<IngressFailure>()(
  "GitHub.IngressFailure",
  {},
) {}

/** What a confirmed attachment supplies; the route adds its own conversation key and source. */
export type Confirmation = Omit<Reservation, "conversationKey" | "source">;

export interface Dependencies {
  readonly workspaceId: string;
  readonly installationId: string;
  readonly repository: { readonly owner: string; readonly name: string };
  readonly secret: Redacted.Redacted<string>;
  readonly role: (login: string) => Effect.Effect<Role, IngressFailure>;
  readonly routeOf: (
    conversationKey: string,
  ) => Effect.Effect<{ readonly taskId: string } | undefined, IngressFailure>;
  /** Asks the marked task whether it opened this pull request; null when it did not. */
  readonly confirm: (
    taskId: string,
    source: Source,
  ) => Effect.Effect<Confirmation | null, IngressFailure>;
  readonly attach: (route: Reservation) => Effect.Effect<void, IngressFailure>;
  readonly admit: (input: Input) => Effect.Effect<void, IngressFailure>;
  readonly kick: Effect.Effect<void, IngressFailure>;
}

const writers = new Set<Role>(["admin", "maintain", "write"]);
const ok = () => HttpServerResponse.empty({ status: 200 });

/**
 * Pull request feedback ingress. Only verified deliveries, for the configured installation and
 * repository, from collaborators with write access, and never from bots or apps, reach the inbox.
 * A pull request routes to a task only after that task confirms it opened the pull request.
 */
export const handler = (dependencies: Dependencies) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (request.method !== "POST") return HttpServerResponse.empty({ status: 404 });
    const raw = new Uint8Array(yield* request.arrayBuffer);
    yield* Webhooks.verify(
      raw,
      request.headers["x-hub-signature-256"] ?? null,
      dependencies.secret,
    );
    const decoded = yield* Webhooks.decode(
      request.headers["x-github-event"] ?? null,
      request.headers["x-github-delivery"] ?? null,
      raw,
    );
    if (decoded.type === "ping") return ok();
    if (decoded.type === "ignored") return ok();
    const feedback = decoded.feedback;
    if (
      feedback.installationId !== dependencies.installationId ||
      feedback.repository.owner !== dependencies.repository.owner ||
      feedback.repository.name !== dependencies.repository.name
    ) {
      yield* Effect.logInfo("github.ignored foreign-repository");
      return ok();
    }
    // Notus's own comments, and any bot or app, must never start another round.
    if (
      feedback.author.type === "Bot" ||
      feedback.author.login.endsWith("[bot]") ||
      feedback.viaAppId !== null
    ) {
      yield* Effect.logInfo("github.ignored bot");
      return ok();
    }
    const occurredAt = Webhooks.orderedTimestamp(feedback.createdAt);
    if (occurredAt === null) return HttpServerResponse.empty({ status: 400 });
    const source: Source = {
      kind: "github",
      installationId: feedback.installationId,
      conversationId: key(
        feedback.repository.owner,
        feedback.repository.name,
        String(feedback.pullNumber),
      ),
    };
    const conversationKey = yield* githubConversationKey(dependencies.workspaceId, source).pipe(
      Effect.mapError(() => new Webhooks.InvalidEnvelope({})),
    );
    const role = yield* dependencies.role(feedback.author.login);
    if (!writers.has(role)) {
      yield* Effect.logInfo(`github.ignored role=${role}`);
      return ok();
    }
    const route = yield* dependencies.routeOf(conversationKey);
    if (!route) {
      const taskId = Webhooks.markedTask(feedback.pullBody);
      if (taskId === null) {
        yield* Effect.logInfo("github.ignored unmarked-pull-request");
        return ok();
      }
      const confirmed = yield* dependencies.confirm(taskId, source);
      if (confirmed === null) {
        yield* Effect.logWarning("github.ignored unconfirmed-attachment");
        return ok();
      }
      yield* dependencies.attach({ ...confirmed, conversationKey, source });
      yield* Effect.logInfo("github.attached");
    }
    yield* dependencies.admit({
      workspaceId: dependencies.workspaceId,
      eventId: key(feedback.installationId, feedback.deliveryId),
      // The inbox recomputes identity keys server-side; these placeholders are never trusted.
      inputId: "pending",
      messageKey: "pending",
      conversationKey,
      actor: {
        kind: "github",
        installationId: feedback.installationId,
        externalId: feedback.author.login,
      },
      target: { source, targetId: key(feedback.target.kind, feedback.target.id) },
      // A review comment is about one line; the operator needs that anchor to change the right code.
      text:
        feedback.location === null
          ? feedback.body
          : `Review comment on ${feedback.location.path}${feedback.location.line === null ? "" : ` line ${feedback.location.line}`} (line numbers refer to the pull request branch):\n${feedback.body}`,
      occurredAt,
      startIntent: false,
    });
    yield* dependencies.kick.pipe(Effect.catchCause(() => Effect.logWarning("github.kick_failed")));
    return ok();
  }).pipe(
    Effect.catchTag(["GitHub.InvalidSignature", "GitHub.InvalidEnvelope"], (error) =>
      Effect.succeed(
        HttpServerResponse.empty({ status: error._tag === "GitHub.InvalidSignature" ? 401 : 400 }),
      ),
    ),
    Effect.catchTag("GitHub.IngressFailure", () =>
      Effect.logError("github.intake_failed").pipe(
        Effect.as(HttpServerResponse.empty({ status: 503 })),
      ),
    ),
  );

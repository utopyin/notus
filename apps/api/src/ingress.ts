import type { Conflict, IntakeError, Unauthorized } from "@notus/control/errors";
import type { InstallationRef } from "@notus/platform/ids";
import type { Platform } from "@notus/platform/platform";
import { Platforms } from "@notus/platforms/registry";
import {
  conversationKeyOf,
  type Input,
  type Reservation,
  type Source,
} from "@notus/platform/source";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

/** A dependency failed; the delivery could not be recorded and the platform is told so with 503. */
export class IngressFailure extends Schema.TaggedError<IngressFailure>()("Ingress.Failure", {}) {}

/** What a confirmed attachment supplies; the route adds its own conversation key and source. */
export type Confirmation = Omit<Reservation, "conversationKey" | "source">;

export interface Dependencies {
  /** The workspace an installation belongs to; null means nobody asked for its events. */
  readonly workspaceOf: (ref: InstallationRef) => Effect.Effect<string | null, IngressFailure>;
  /** Whether the workspace covers the scope; checked before the adapter spends a provider call. */
  readonly covers: (workspaceId: string, source: Source) => Effect.Effect<boolean, IngressFailure>;
  readonly routeOf: (
    conversationKey: string,
  ) => Effect.Effect<{ readonly taskId: string } | undefined, IngressFailure>;
  /** Asks the task a conversation claims as its opener whether it did; null when it did not. */
  readonly confirm: (
    taskId: string,
    source: Source,
  ) => Effect.Effect<Confirmation | null, IngressFailure>;
  readonly attach: (route: Reservation) => Effect.Effect<void, IngressFailure>;
  readonly admit: (
    input: Input,
  ) => Effect.Effect<unknown, Conflict | IntakeError | Unauthorized | IngressFailure>;
  readonly kick: Effect.Effect<void, IngressFailure>;
}

const ok = () => HttpServerResponse.empty({ status: 200 });
const ignored = (reason: string) =>
  Effect.logInfo(`ingress.ignored ${reason}`).pipe(Effect.as(ok()));

/**
 * One ingress for every platform: the adapter verifies and normalizes, this route resolves the
 * workspace, lets the adapter rule on the actor, attaches a conversation a task confirms it opened,
 * and admits the input. Nothing here knows what a channel or a pull request is.
 */
export const handler = (platform: Platform, dependencies: Dependencies) =>
  Effect.gen(function* () {
    const platforms = yield* Platforms.Service;
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (request.method !== "POST") return HttpServerResponse.empty({ status: 404 });
    const scope = yield* platforms.forPlatform(platform);
    const body = new Uint8Array(yield* request.arrayBuffer);
    const normalized = yield* scope.ingress.receive({
      body,
      header: (name) => request.headers[name] ?? null,
    });
    if (normalized.type === "acknowledge") return yield* HttpServerResponse.json(normalized.body);
    if (normalized.type === "ignored") return yield* ignored(normalized.reason);
    const { received, claim } = normalized;
    const source = received.target.source;
    const workspaceId = yield* dependencies.workspaceOf(source);
    if (workspaceId === null) return yield* ignored("foreign-installation");
    if (!(yield* dependencies.covers(workspaceId, source))) return yield* ignored("scope");
    const port = yield* platforms.forInstallation(source);
    if (!(yield* port.identity.mayParticipate(received.actor, source.scope)))
      return yield* ignored("actor");
    const conversationKey = conversationKeyOf(workspaceId, source);
    if (claim !== null && (yield* dependencies.routeOf(conversationKey)) === undefined) {
      const confirmed = yield* dependencies.confirm(claim.taskId, source);
      if (confirmed === null) {
        yield* Effect.logWarning("ingress.ignored unconfirmed-attachment");
        return ok();
      }
      yield* dependencies.attach({ ...confirmed, conversationKey, source });
      yield* Effect.logInfo("ingress.attached");
    }
    yield* dependencies.admit({
      workspaceId,
      // The inbox recomputes identity keys server-side; these placeholders are never trusted.
      inputId: "pending",
      messageKey: "pending",
      conversationKey,
      eventId: received.eventId,
      actor: received.actor,
      target: received.target,
      text: received.text,
      occurredAt: received.occurredAt,
      startIntent: received.startIntent,
      root: received.root,
    });
    // Durable admission already succeeded. A failed best-effort kick must not turn
    // acknowledgement into failure; the independent cron will recover it.
    yield* dependencies.kick.pipe(Effect.catchCause(() => Effect.logWarning("inbox.kick_failed")));
    return ok();
  }).pipe(
    Effect.catchTags({
      "Sources.IngressError": (error) =>
        Effect.succeed(
          HttpServerResponse.empty({
            status: error.reason === "signature" ? 401 : error.reason === "envelope" ? 400 : 404,
          }),
        ),
      "Sources.PlatformNotRegistered": () =>
        Effect.succeed(HttpServerResponse.empty({ status: 404 })),
      "Sources.InstallationNotFound": () => ignored("unknown-installation"),
      // Not this workspace's channel or repository, or a starter without authority: acknowledged, dropped.
      "Control.Unauthorized": (error) => ignored(error.reason),
    }),
    Effect.catch(() =>
      Effect.logError("ingress.failed").pipe(Effect.as(HttpServerResponse.empty({ status: 503 }))),
    ),
  );

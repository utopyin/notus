import { Platform } from "@notus/platform/platform";
import { conversationKeyOf } from "@notus/platform/source";
import { Platforms } from "@notus/platforms/registry";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { Drain } from "./drain";
import { Inbox } from "./inbox";

const ok = () => HttpServerResponse.empty({ status: 200 });
const notFound = () => HttpServerResponse.empty({ status: 404 });

const ignored = (reason: string) =>
  Effect.logInfo(`ingress.ignored ${reason}`).pipe(Effect.as(ok()));

/**
 * Every platform's deliveries, at `POST /<platform>/events`, authenticated by the platform's own
 * signature. The adapter verifies and normalizes; this route resolves the workspace, lets the
 * adapter rule on the actor, and admits the input. Nothing here knows what a channel or a pull
 * request is. A conversation is routed by the task that opened it or checked it out.
 */
export const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const platforms = yield* Platforms.Service;
    const inbox = yield* Inbox.Service;
    const drain = yield* Drain.Service;

    const receive = Effect.gen(function* () {
      const { platform } = yield* HttpRouter.params;

      if (!Schema.is(Platform)(platform)) return notFound();

      const request = yield* HttpServerRequest.HttpServerRequest;
      const scope = yield* platforms.forPlatform(platform);
      const body = new Uint8Array(yield* request.arrayBuffer);

      const normalized = yield* scope.ingress.receive({
        body,
        header: (name) => request.headers[name] ?? null,
      });

      if (normalized.type === "acknowledge") return yield* HttpServerResponse.json(normalized.body);
      if (normalized.type === "ignored") return yield* ignored(normalized.reason);

      const { received } = normalized;
      const source = received.target.source;
      const workspaceId = yield* inbox.workspaceOf(source);
      if (workspaceId === null) return yield* ignored("foreign-installation");
      if (!(yield* inbox.covers(workspaceId, source))) return yield* ignored("scope");

      const port = yield* platforms.forInstallation(source);

      if (!(yield* port.identity.mayParticipate(received.actor, source.scope)))
        return yield* ignored("actor");

      yield* inbox.admit({
        workspaceId,
        // The inbox recomputes identity keys server-side; these placeholders are never trusted.
        inputId: "pending",
        messageKey: "pending",
        conversationKey: conversationKeyOf(workspaceId, source),
        eventId: received.eventId,
        actor: received.actor,
        target: received.target,
        text: received.text,
        occurredAt: received.occurredAt,
        startIntent: received.startIntent,
        root: received.root,
      });

      // Admission is durable already. The pass runs once the platform has its answer; the
      // schedule recovers whatever it misses.
      yield* Effect.addFinalizer(() => drain.run);

      return ok();
    }).pipe(
      Effect.catchTags({
        "Sources.IngressError": (error) =>
          Effect.succeed(
            HttpServerResponse.empty({
              status: error.reason === "signature" ? 401 : error.reason === "envelope" ? 400 : 404,
            }),
          ),
        "Sources.PlatformNotRegistered": () => Effect.succeed(notFound()),
        "Sources.InstallationNotFound": () => ignored("unknown-installation"),
        // Not this workspace's channel or repository, or a starter without authority: acknowledged, dropped.
        "Control.Unauthorized": (error) => ignored(error.reason),
      }),
      Effect.catch(() =>
        Effect.logError("ingress.failed").pipe(
          Effect.as(HttpServerResponse.empty({ status: 503 })),
        ),
      ),
    );

    yield* router.add("POST", "/:platform/events", receive);
  }),
);

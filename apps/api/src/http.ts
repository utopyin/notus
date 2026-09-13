import type { Input } from "@notus/contracts/source";
import type { Conflict, IntakeError, Unauthorized } from "@notus/control/errors";
import * as Events from "@notus/slack/events";
import { Sources } from "@notus/tasks/sources";
import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import type { DeploymentConfig } from "./config";

/** Injectable effects keep signed ingress independent of Alchemy bindings. */
export const handler = <E, R, EK, RK>(
  config: DeploymentConfig,
  admit: (input: Input) => Effect.Effect<unknown, E | Conflict | IntakeError | Unauthorized, R>,
  kick: Effect.Effect<void, EK, RK>,
) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const path = new URL(request.url, "https://notus.invalid").pathname;
    if (request.method === "GET" && path === "/health") {
      return HttpServerResponse.text("ok");
    }
    if (request.method !== "POST" || path !== "/slack/events") {
      return HttpServerResponse.empty({ status: 404 });
    }
    const raw = new Uint8Array(yield* request.arrayBuffer);
    yield* Events.verify(
      raw,
      request.headers["x-slack-request-timestamp"] ?? null,
      request.headers["x-slack-signature"] ?? null,
      config.signingSecret,
    );
    const normalized = Sources.normalize(yield* Events.decode(raw), config);
    if (normalized.type === "challenge") {
      return yield* HttpServerResponse.json({ challenge: normalized.challenge });
    }
    if (normalized.type === "ignored") return HttpServerResponse.empty({ status: 200 });
    yield* admit(normalized.input);
    // Durable admission already succeeded. A failed best-effort kick must not
    // turn acknowledgement into failure; the independent cron will recover it.
    yield* kick.pipe(Effect.catchCause(() => Effect.logWarning("inbox.kick_failed")));
    return HttpServerResponse.empty({ status: 200 });
  }).pipe(
    Effect.catchTag(
      ["Slack.InvalidSignature", "Slack.InvalidEnvelope", "Control.Unauthorized"],
      (error) =>
        Effect.succeed(
          HttpServerResponse.empty({
            status:
              error._tag === "Slack.InvalidSignature"
                ? 401
                : error._tag === "Slack.InvalidEnvelope"
                  ? 400
                  : 200,
          }),
        ),
    ),
    Effect.catch(() =>
      Effect.logError("intake.failed").pipe(Effect.as(HttpServerResponse.empty({ status: 503 }))),
    ),
  );

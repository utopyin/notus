import type { ConnectionError } from "@notus/accounts/errors";
import { Model } from "@notus/openai/model";
import { RuntimeContext } from "alchemy/RuntimeContext";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientError from "effect/http/HttpClientError";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import type { OperatorConfig } from "./config";
import { ConnectionObject } from "./objects/connection";

/** Which user's connection and which durable operation a model request belongs to. */
export const Operation = Context.Reference<{
  readonly userId: string;
  readonly operationId: string;
} | null>("@notus/control/Broker.Operation", { defaultValue: () => null });

// The model client sees an ordinary HTTP status; the reason travels in the body for diagnostics.
const statuses: Record<ConnectionError["reason"], number> = {
  "not-linked": 401,
  revoked: 401,
  "reconnect-required": 401,
  unauthorized: 401,
  "invalid-input": 400,
  conflict: 409,
  "provider-rejected": 502,
  "provider-unavailable": 503,
  storage: 503,
};

/**
 * HttpClient whose only transport is the initiator's Connection object. Requests carry no
 * credentials; the object adds them and replays an identical operation without a second charge.
 * Built inside an object instance, whose runtime context every model request runs in.
 */
export const client = Effect.gen(function* () {
  const remote = yield* ConnectionObject.Remote;
  const runtime = yield* RuntimeContext;

  return HttpClient.make((request, url) =>
    Effect.gen(function* () {
      const transport = (description: string) =>
        new HttpClientError.HttpClientError({
          reason: new HttpClientError.TransportError({ request, description }),
        });

      const operation = yield* Operation;
      if (operation === null) return yield* transport("model request outside an operation");

      const body = request.body;

      if (request.method !== "POST" || body._tag !== "Uint8Array")
        return yield* transport("unsupported model request");

      const text = yield* Effect.try({
        try: () => new TextDecoder("utf-8", { fatal: true }).decode(body.body),
        catch: () => transport("unreadable model request"),
      });

      const result = yield* remote(operation.userId)
        .forward(operation.userId, operation.operationId, {
          method: "POST",
          url: url.toString(),
          contentType: body.contentType,
          body: text,
        })
        .pipe(Effect.mapError(() => transport("connection unavailable")));
      const response = result.ok
        ? new Response(result.value.body, {
            status: result.value.status,
            headers: {
              ...(result.value.contentType ? { "content-type": result.value.contentType } : {}),
              ...(result.value.retryAfter ? { "retry-after": result.value.retryAfter } : {}),
            },
          })
        : Response.json(
            {
              error: {
                message: `notus connection: ${result.reason}`,
                type: "notus_connection",
                code: result.reason,
              },
            },
            { status: statuses[result.reason] },
          );

      return HttpClientResponse.fromWeb(request, response);
    }).pipe(Effect.provideService(RuntimeContext, runtime)),
  );
});

/** The operator's model, whose only transport is the initiator's Connection object. */
export const languageModel = (options: OperatorConfig) =>
  Model.languageModel(options).pipe(Layer.provide(Layer.effect(HttpClient.HttpClient, client)));

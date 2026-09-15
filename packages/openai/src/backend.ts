import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import { ForwardError } from "./errors";
import { ForwardRequest, ForwardResponse } from "./types";

/**
 * The one OpenAI backend a Worker can reach. OpenAI's edge refuses every request arriving from
 * Cloudflare's network before reading the token (see docs/research/openai-auth.md), so the
 * subscription backend at chatgpt.com only ever serves Codex on the dev box, which carries the
 * subscription login. The operator runs on the Platform API with the initiator's key.
 */
export const endpoint = "https://api.openai.com/v1";
export const responsesUrl = `${endpoint}/responses`;
const maxRequestBytes = 512 * 1024;
const maxResponseBytes = 1024 * 1024;

export interface Credentials {
  readonly key: Redacted.Redacted<string>;
}

/** The only provider call a broker performs for a caller: one Responses request with the owner's bearer. */
export const forward = Effect.fn("OpenAi.Backend.forward")(
  function* (credentials: Credentials, input: ForwardRequest) {
    const unsupported = () => new ForwardError({ reason: "unsupported-request" });
    const request = yield* Schema.decodeEffect(ForwardRequest)(input).pipe(
      Effect.mapError(unsupported),
    );
    if (
      request.url !== responsesUrl ||
      request.contentType.split(";")[0]?.trim().toLowerCase() !== "application/json" ||
      new TextEncoder().encode(request.body).byteLength > maxRequestBytes
    )
      return yield* unsupported();
    const http = yield* HttpClient.HttpClient;
    const authorized = HttpClientRequest.post(request.url).pipe(
      HttpClientRequest.setHeaders({ accept: "application/json" }),
      HttpClientRequest.bodyText(request.body, "application/json"),
      HttpClientRequest.bearerToken(credentials.key),
    );
    const response = yield* http
      .execute(authorized)
      .pipe(Effect.mapError(() => new ForwardError({ reason: "transport" })));
    let length = 0;
    const chunks: Uint8Array[] = [];
    yield* response.stream.pipe(
      Stream.runForEach((chunk) => {
        length += chunk.byteLength;
        if (length > maxResponseBytes)
          return Effect.fail(new ForwardError({ reason: "invalid-response" }));
        chunks.push(chunk);
        return Effect.void;
      }),
      Effect.mapError(() => new ForwardError({ reason: "invalid-response" })),
    );
    const body = yield* Effect.try({
      try: () => {
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      },
      catch: () => new ForwardError({ reason: "invalid-response" }),
    });
    return ForwardResponse.make({
      status: response.status,
      contentType: response.headers["content-type"] ?? null,
      retryAfter: response.headers["retry-after"] ?? null,
      body,
    });
  },
  Effect.scoped,
  Effect.timeoutOrElse({
    duration: "120 seconds",
    orElse: () => Effect.fail(new ForwardError({ reason: "timeout" })),
  }),
);

export * as Backend from "./backend";

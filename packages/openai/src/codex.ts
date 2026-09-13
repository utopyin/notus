import * as Effect from "effect/Effect";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import { ForwardError } from "./errors";
import { ForwardRequest, ForwardResponse } from "./types";

/** ChatGPT subscription backend used by the Codex client. Not the Platform API. */
export const endpoint = "https://chatgpt.com/backend-api/codex";
export const responsesUrl = `${endpoint}/responses`;
const maxRequestBytes = 512 * 1024;
const maxResponseBytes = 1024 * 1024;

export interface Credentials {
  readonly access: Redacted.Redacted<string>;
  readonly accountId: string;
}

/** The only provider call a broker performs for a caller: one Responses request with the owner's bearer. */
export const forward = Effect.fn("OpenAi.Codex.forward")(
  function* (credentials: Credentials, input: ForwardRequest) {
    const unsupported = () => new ForwardError({ reason: "unsupported-request" });
    const request = yield* Schema.decodeEffect(ForwardRequest)(input).pipe(
      Effect.mapError(unsupported),
    );
    if (
      request.url !== responsesUrl ||
      request.contentType.split(";")[0]?.trim().toLowerCase() !== "application/json" ||
      new TextEncoder().encode(request.body).byteLength > maxRequestBytes ||
      !/^[a-zA-Z0-9_-]{1,256}$/.test(credentials.accountId)
    )
      return yield* unsupported();
    const http = yield* HttpClient.HttpClient;
    const response = yield* http
      .execute(
        HttpClientRequest.post(responsesUrl).pipe(
          HttpClientRequest.setHeaders({
            accept: "application/json",
            "chatgpt-account-id": credentials.accountId,
            "openai-beta": "responses=experimental",
            originator: "notus",
          }),
          HttpClientRequest.bearerToken(credentials.access),
          HttpClientRequest.bodyText(request.body, "application/json"),
        ),
      )
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

export * as Codex from "./codex";

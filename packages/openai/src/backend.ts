import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import { ForwardError } from "./errors";
import { ForwardRequest, ForwardResponse, Provider } from "./types";

/**
 * Two OpenAI backends with different identity and billing. Selecting one is an explicit
 * configuration decision; nothing here falls back from one to the other.
 */
export const endpoint = (provider: Provider): string =>
  provider === "openai-chatgpt"
    ? "https://chatgpt.com/backend-api/codex"
    : "https://api.openai.com/v1";
export const responsesUrl = (provider: Provider): string => `${endpoint(provider)}/responses`;
const maxRequestBytes = 512 * 1024;
const maxResponseBytes = 1024 * 1024;

export type Credentials =
  | {
      readonly provider: "openai-chatgpt";
      readonly access: Redacted.Redacted<string>;
      readonly accountId: string;
    }
  | { readonly provider: "openai-api"; readonly key: Redacted.Redacted<string> };

/** The only provider call a broker performs for a caller: one Responses request with the owner's bearer. */
export const forward = Effect.fn("OpenAi.Backend.forward")(
  function* (credentials: Credentials, input: ForwardRequest) {
    const unsupported = () => new ForwardError({ reason: "unsupported-request" });
    const request = yield* Schema.decodeEffect(ForwardRequest)(input).pipe(
      Effect.mapError(unsupported),
    );
    if (
      request.url !== responsesUrl(credentials.provider) ||
      request.contentType.split(";")[0]?.trim().toLowerCase() !== "application/json" ||
      new TextEncoder().encode(request.body).byteLength > maxRequestBytes ||
      (credentials.provider === "openai-chatgpt" &&
        !/^[a-zA-Z0-9_-]{1,256}$/.test(credentials.accountId))
    )
      return yield* unsupported();
    const http = yield* HttpClient.HttpClient;
    const base = HttpClientRequest.post(request.url).pipe(
      HttpClientRequest.setHeaders({ accept: "application/json" }),
      HttpClientRequest.bodyText(request.body, "application/json"),
    );
    const authorized =
      credentials.provider === "openai-chatgpt"
        ? base.pipe(
            HttpClientRequest.setHeaders({
              "chatgpt-account-id": credentials.accountId,
              "openai-beta": "responses=experimental",
              originator: "notus",
            }),
            HttpClientRequest.bearerToken(credentials.access),
          )
        : base.pipe(HttpClientRequest.bearerToken(credentials.key));
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

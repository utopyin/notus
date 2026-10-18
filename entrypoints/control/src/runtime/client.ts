import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Protocol from "./protocol";

export class Failure extends Schema.TaggedError<Failure>()("Runtime.CallbackFailure", {
  reason: Schema.Literals(["configuration", "transport", "rejected", "response"]),
  retryable: Schema.Boolean,
}) {}
export class Configuration extends Context.Service<
  Configuration,
  { readonly controlUrl: string }
>()("@notus/control/Runtime.Client.Configuration") {}
export interface Interface {
  readonly assignment: (
    credential: Redacted.Redacted<string>,
  ) => Effect.Effect<Protocol.Assignment, Failure>;
  readonly enroll: (
    credential: Redacted.Redacted<string>,
    request: Protocol.EnrollmentRequest,
  ) => Effect.Effect<Protocol.EnrollmentReply, Failure>;
  readonly ready: (
    credential: Redacted.Redacted<string>,
    request: Protocol.ReadinessRequest,
  ) => Effect.Effect<Protocol.ReadinessReply, Failure>;
  /** Held by the host up to waitMs; the client deadline covers that wait. */
  readonly poll: (
    credential: Redacted.Redacted<string>,
    request: Protocol.PollRequest,
  ) => Effect.Effect<Protocol.PollReply, Failure>;
  readonly observe: (
    credential: Redacted.Redacted<string>,
    request: Protocol.ObserveRequest,
  ) => Effect.Effect<Protocol.ObserveReply, Failure>;
  /** The initiator's GitHub sign-in for git on the box, fresh for at least an hour. */
  readonly login: (
    credential: Redacted.Redacted<string>,
  ) => Effect.Effect<Protocol.LoginReply, Failure>;
}
export class Service extends Context.Service<Service, Interface>()(
  "@notus/control/Runtime.Client",
) {}

const failure = (reason: Failure["reason"], retryable = false) =>
  new Failure({ reason, retryable });

export const layerNoDeps = Layer.effect(
  Service,
  Effect.gen(function* () {
    const settings = yield* Configuration;

    const base = yield* Effect.try({
      try: () => {
        const url = new URL(settings.controlUrl);

        if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
          throw new Error();

        return url.href.replace(/\/$/, "");
      },
      catch: () => failure("configuration"),
    });

    const http = HttpClient.withScope(yield* HttpClient.HttpClient);

    const call = Effect.fn("Runtime.Client.call")(
      function* <A>(
        operation: string,
        credential: Redacted.Redacted<string>,
        body: unknown,
        responseSchema: Schema.Codec<A, unknown>,
        _timeoutMs = 10_000,
      ) {
        if (!Redacted.isRedacted(credential) || Redacted.value(credential).length > 6200)
          return yield* failure("configuration");

        const request = yield* HttpClientRequest.post(`${base}/${operation}`).pipe(
          HttpClientRequest.bearerToken(credential),
          HttpClientRequest.acceptJson,
          HttpClientRequest.bodyJson(body),
          Effect.mapError(() => failure("configuration")),
        );

        const response = yield* http
          .execute(request)
          .pipe(Effect.mapError(() => failure("transport", true)));

        if (response.status !== 200)
          return yield* failure(
            "rejected",
            [425, 429, 500, 502, 503, 504].includes(response.status),
          );

        if (
          response.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !==
          "application/json"
        )
          return yield* failure("response");

        let length = 0;
        const chunks: Uint8Array[] = [];

        yield* response.stream.pipe(
          Stream.runForEach((chunk) => {
            length += chunk.byteLength;

            if (length > 16 * 1024) return Effect.fail(failure("response"));

            chunks.push(chunk);

            return Effect.void;
          }),
          Effect.mapError(() => failure("response", true)),
        );

        const text = yield* Effect.try({
          try: () => {
            const bytes = new Uint8Array(length);
            let offset = 0;

            for (const chunk of chunks) {
              bytes.set(chunk, offset);
              offset += chunk.byteLength;
            }

            return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          },
          catch: () => failure("response"),
        });

        return yield* Schema.decodeEffect(Schema.fromJsonString(responseSchema))(text).pipe(
          Effect.mapError(() => failure("response")),
        );
      },
      Effect.scoped,
      Effect.provideService(FetchHttpClient.RequestInit, {
        redirect: "manual",
        credentials: "omit",
      }),
      (effect, _operation, _credential, _body, _schema, timeoutMs = 10_000) =>
        effect.pipe(
          Effect.timeoutOrElse({
            duration: timeoutMs,
            orElse: () => Effect.fail(failure("transport", true)),
          }),
        ),
    );

    return Service.of({
      assignment: Effect.fn("Runtime.Client.assignment")((credential) =>
        call("assignment", credential, {}, Protocol.Assignment),
      ),
      enroll: Effect.fn("Runtime.Client.enroll")(function* (credential, request) {
        const body = yield* Schema.encodeEffect(Protocol.EnrollmentRequest)(request).pipe(
          Effect.mapError(() => failure("configuration")),
        );

        return yield* call("enroll", credential, body, Protocol.EnrollmentReply);
      }),
      ready: Effect.fn("Runtime.Client.ready")(function* (credential, request) {
        const body = yield* Schema.encodeEffect(Protocol.ReadinessRequest)(request).pipe(
          Effect.mapError(() => failure("configuration")),
        );

        return yield* call("ready", credential, body, Protocol.ReadinessReply);
      }),
      poll: Effect.fn("Runtime.Client.poll")(function* (credential, request) {
        const body = yield* Schema.encodeEffect(Protocol.PollRequest)(request).pipe(
          Effect.mapError(() => failure("configuration")),
        );

        return yield* call("poll", credential, body, Protocol.PollReply, request.waitMs + 10_000);
      }),
      observe: Effect.fn("Runtime.Client.observe")(function* (credential, request) {
        const body = yield* Schema.encodeEffect(Protocol.ObserveRequest)(request).pipe(
          Effect.mapError(() => failure("configuration")),
        );

        return yield* call("observe", credential, body, Protocol.ObserveReply);
      }),
      login: Effect.fn("Runtime.Client.login")((credential) =>
        call("login", credential, {}, Protocol.LoginReply),
      ),
    });
  }),
);
export const layer = layerNoDeps.pipe(Layer.provide(FetchHttpClient.layer));
export * as RuntimeClient from "./client";

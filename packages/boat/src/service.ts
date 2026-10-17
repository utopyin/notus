import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { Config } from "./config";
import { BoatError, type Operation } from "./errors";
import { type CommandResult, type CreateInput, Sandbox, SandboxId } from "./types";

/**
 * The few Boat calls a devbox needs, over `https://boat.dev/api/v1`. Every mutation's outcome is
 * classified; provider messages, bodies and headers never leave this module. See
 * docs/research/boat.md for what each call was observed to do.
 */
export interface Interface {
  readonly create: (input: CreateInput) => Effect.Effect<Sandbox, BoatError>;
  readonly get: (id: string) => Effect.Effect<Sandbox, BoatError>;
  readonly stop: (id: string) => Effect.Effect<Sandbox, BoatError>;
  readonly resume: (id: string) => Effect.Effect<Sandbox, BoatError>;
  readonly remove: (id: string) => Effect.Effect<void, BoatError>;
  /** A short synchronous command on the running machine, as the sandbox user. */
  readonly command: (
    id: string,
    command: string,
    timeoutSeconds: number,
  ) => Effect.Effect<CommandResult, BoatError>;
}
export class Service extends Context.Service<Service, Interface>()("@notus/boat/Service") {}

const maxResponseBytes = 1024 * 1024;
const Code = Schema.String.check(Schema.isPattern(/^[A-Za-z_]{1,64}$/));
const ErrorBody = Schema.Struct({ code: Schema.optionalKey(Schema.Unknown) });
const SandboxEnvelope = Schema.Struct({ sandbox: Sandbox });
const CommandEnvelope = Schema.Struct({
  exitCode: Schema.NullOr(Schema.Int),
  stdout: Schema.String,
});

/** Statuses after which Boat documents that the call changed nothing. */
const refusing = new Set([400, 401, 402, 403, 409, 422, 429, 503]);

export const layerNoDeps = Layer.effect(
  Service,
  Effect.gen(function* () {
    const settings = yield* Config.Service;
    const http = HttpClient.withScope(yield* HttpClient.HttpClient);
    const fail = (
      operation: Operation,
      reason: BoatError["reason"],
      outcome: BoatError["outcome"],
      extra: { status?: number; code?: string } = {},
    ) => new BoatError({ operation, reason, outcome, ...extra });
    if (
      !Redacted.isRedacted(settings.credential) ||
      !/^[\x21-\x7e]{1,4096}$/.test(Redacted.value(settings.credential))
    )
      return yield* fail("get", "invalidInput", "notSent");

    const read = (operation: Operation, stream: Stream.Stream<Uint8Array, unknown>) =>
      Effect.gen(function* () {
        let size = 0;
        const chunks: Array<Uint8Array> = [];
        yield* stream.pipe(
          Stream.runForEach((chunk) => {
            size += chunk.byteLength;
            if (size > maxResponseBytes)
              return Effect.fail(fail(operation, "invalidResponse", "unknown"));
            chunks.push(chunk);
            return Effect.void;
          }),
          Effect.mapError(() => fail(operation, "invalidResponse", "unknown")),
        );
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return yield* Effect.try({
          try: () => new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          catch: () => fail(operation, "invalidResponse", "unknown"),
        });
      });

    const call = Effect.fn("Boat.call")(
      function* (
        operation: Operation,
        method: "GET" | "POST" | "DELETE",
        path: string,
        body: unknown,
        headers: Readonly<Record<string, string>>,
      ) {
        const base = HttpClientRequest.make(method)(`${Config.endpoint}${path}`).pipe(
          HttpClientRequest.acceptJson,
          HttpClientRequest.bearerToken(settings.credential),
          HttpClientRequest.setHeaders(headers),
        );
        const request =
          body === undefined
            ? base
            : yield* HttpClientRequest.bodyJson(base, body).pipe(
                Effect.mapError(() => fail(operation, "invalidInput", "notSent")),
              );
        const response = yield* http
          .execute(request)
          .pipe(Effect.mapError(() => fail(operation, "transport", "unknown")));
        const text = yield* read(operation, response.stream);
        if (response.status < 200 || response.status > 299) {
          const parsed = yield* Schema.decodeEffect(Schema.fromJsonString(ErrorBody))(text).pipe(
            Effect.orElseSucceed(() => ({ code: undefined })),
          );
          const code = Schema.is(Code)(parsed.code) ? parsed.code : undefined;
          return yield* fail(
            operation,
            "http",
            response.status === 404
              ? "notFound"
              : refusing.has(response.status)
                ? "rejected"
                : "unknown",
            { status: response.status, ...(code === undefined ? {} : { code }) },
          );
        }
        return yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(text).pipe(
          Effect.mapError(() => fail(operation, "invalidResponse", "unknown")),
        );
      },
      (effect, operation) =>
        effect.pipe(
          Effect.scoped,
          Effect.provideService(FetchHttpClient.RequestInit, {
            redirect: "manual",
            credentials: "omit",
          }),
          Effect.timeoutOrElse({
            duration: settings.timeoutMs,
            orElse: () => Effect.fail(fail(operation, "timeout", "unknown")),
          }),
        ),
    );
    const id = (operation: Operation, value: string) =>
      Schema.decodeEffect(SandboxId)(value).pipe(
        Effect.mapError(() => fail(operation, "invalidInput", "notSent")),
      );
    const sandbox = (operation: Operation) => (payload: unknown) =>
      Schema.decodeUnknownEffect(SandboxEnvelope)(payload).pipe(
        Effect.map((envelope) => envelope.sandbox),
        Effect.mapError(() => fail(operation, "invalidResponse", "unknown")),
      );

    return Service.of({
      create: (input) =>
        call(
          "create",
          "POST",
          "/sandboxes",
          {
            from: input.from,
            ...(input.type === undefined ? {} : { type: input.type }),
            ...(input.ttlSeconds === undefined ? {} : { ttlSeconds: input.ttlSeconds }),
            // None of the account's own secrets, files or credentials reach the box.
            noEnv: true,
            env: input.env,
            setupScript: input.setupScript,
          },
          { "Idempotency-Key": input.idempotencyKey },
        ).pipe(Effect.flatMap(sandbox("create"))),
      get: (value) =>
        id("get", value).pipe(
          Effect.flatMap((sandboxId) =>
            call("get", "GET", `/sandboxes/${sandboxId}`, undefined, {}),
          ),
          Effect.flatMap(sandbox("get")),
        ),
      stop: (value) =>
        id("stop", value).pipe(
          Effect.flatMap((sandboxId) =>
            call("stop", "POST", `/sandboxes/${sandboxId}/stop`, {}, {}),
          ),
          Effect.flatMap(sandbox("stop")),
        ),
      resume: (value) =>
        id("resume", value).pipe(
          Effect.flatMap((sandboxId) =>
            call("resume", "POST", `/sandboxes/${sandboxId}/resume`, {}, {}),
          ),
          Effect.flatMap(sandbox("resume")),
        ),
      remove: (value) =>
        id("delete", value).pipe(
          Effect.flatMap((sandboxId) =>
            // Boat refuses a delete unless the header repeats the id.
            call("delete", "DELETE", `/sandboxes/${sandboxId}`, undefined, {
              "X-Ascii-Confirm-Delete": sandboxId,
            }),
          ),
          Effect.asVoid,
        ),
      command: (value, command, timeoutSeconds) =>
        id("command", value).pipe(
          Effect.flatMap((sandboxId) =>
            call(
              "command",
              "POST",
              `/sandboxes/${sandboxId}/commands`,
              { command, timeoutSeconds },
              {},
            ),
          ),
          Effect.flatMap((payload) =>
            Schema.decodeUnknownEffect(CommandEnvelope)(payload).pipe(
              Effect.mapError(() => fail("command", "invalidResponse", "unknown")),
            ),
          ),
        ),
    });
  }),
);
export const layer = layerNoDeps.pipe(Layer.provide(FetchHttpClient.layer));
export * as Boat from "./service";

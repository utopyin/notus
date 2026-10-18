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
import { ConfigError, InstancesError } from "./errors";
import { DestroyedReceipt } from "./types";

export interface Interface {
  readonly destroyed: (instanceId: string) => Effect.Effect<DestroyedReceipt, InstancesError>;
}
export class Service extends Context.Service<Service, Interface>()("@notus/namespace/Instances") {}

const maxResponseBytes = 1024 * 1024;

// Deliberately project only proof fields. DescribeInstance can also return credentials.
const responseSchema = Schema.fromJsonString(
  Schema.Struct({
    metadata: Schema.Struct({
      instanceId: Schema.NonEmptyString,
      status: Schema.String,
      destroyedAt: Schema.optionalKey(Schema.Unknown),
    }),
  }),
);

export const layerNoDeps = Layer.effect(
  Service,
  Effect.gen(function* () {
    const settings = yield* Config.Service;
    const http = HttpClient.withScope(yield* HttpClient.HttpClient);

    const endpoint = yield* Effect.try({
      try: () => {
        const input = settings.computeEndpoint ?? Config.defaultComputeEndpoint;
        const url = new URL(input);

        if (
          !/^https:\/\/[^/]+\/?$/.test(input) ||
          /[\s\\?#]/.test(input) ||
          input.slice(8).split("/")[0]?.includes("@") ||
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          url.pathname !== "/"
        )
          throw new Error();

        return url.origin;
      },
      catch: () =>
        new ConfigError({
          message:
            "Namespace computeEndpoint must be a trusted HTTPS origin without credentials, path, query or fragment",
        }),
    });

    if (
      !Number.isSafeInteger(settings.timeoutMs) ||
      settings.timeoutMs <= 0 ||
      settings.timeoutMs > 2147483647
    ) {
      return yield* new ConfigError({
        message: "Namespace timeoutMs must be a positive bounded integer",
      });
    }

    if (
      !Redacted.isRedacted(settings.credential) ||
      !/^[\x21-\x7e]+$/.test(Redacted.value(settings.credential))
    ) {
      return yield* new ConfigError({
        message: "Namespace requires an explicit nonempty Redacted bearer credential",
      });
    }

    const destroyed = Effect.fn("Namespace.Instances.destroyed")(
      function* (instanceId: string) {
        yield* Schema.decodeEffect(DestroyedReceipt.fields.instanceId)(instanceId).pipe(
          Effect.mapError(() => new InstancesError({ reason: "invalidInput" })),
        );

        const request = yield* HttpClientRequest.post(
          `${endpoint}/namespace.cloud.compute.v1beta.ComputeService/DescribeInstance`,
        ).pipe(
          HttpClientRequest.setHeader("Connect-Protocol-Version", "1"),
          HttpClientRequest.acceptJson,
          HttpClientRequest.bearerToken(settings.credential),
          HttpClientRequest.bodyJson({ instanceId }),
          Effect.mapError(() => new InstancesError({ reason: "invalidInput" })),
        );

        const response = yield* http
          .execute(request)
          .pipe(Effect.mapError(() => new InstancesError({ reason: "transport" })));

        if (response.status !== 200) {
          // NotFound is absence of evidence, never a destruction receipt.
          return yield* new InstancesError({
            reason: response.status === 404 ? "notFound" : "rejected",
            status: response.status,
          });
        }

        if (
          response.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !==
          "application/json"
        ) {
          return yield* new InstancesError({ reason: "invalidResponse" });
        }

        let size = 0;
        const chunks: Uint8Array[] = [];

        yield* response.stream.pipe(
          Stream.runForEach((chunk) => {
            size += chunk.byteLength;

            if (size > maxResponseBytes)
              return Effect.fail(new InstancesError({ reason: "invalidResponse" }));

            chunks.push(chunk);

            return Effect.void;
          }),
          Effect.mapError(() => new InstancesError({ reason: "invalidResponse" })),
        );

        const { metadata } = yield* Effect.try({
          try: () => {
            const bytes = new Uint8Array(size);
            let offset = 0;

            for (const chunk of chunks) {
              bytes.set(chunk, offset);
              offset += chunk.byteLength;
            }

            return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          },
          catch: () => new InstancesError({ reason: "invalidResponse" }),
        }).pipe(
          Effect.flatMap(Schema.decodeEffect(responseSchema)),
          Effect.mapError(() => new InstancesError({ reason: "invalidResponse" })),
        );

        if (metadata.instanceId !== instanceId)
          return yield* new InstancesError({ reason: "identityMismatch" });

        if (metadata.status !== "DESTROYED")
          return yield* new InstancesError({ reason: "notDestroyed" });

        if (metadata.destroyedAt === undefined)
          return yield* new InstancesError({ reason: "missingDestroyedAt" });

        const destroyedAt = yield* Schema.decodeUnknownEffect(DestroyedReceipt.fields.destroyedAt)(
          metadata.destroyedAt,
        ).pipe(Effect.mapError(() => new InstancesError({ reason: "invalidDestroyedAt" })));

        return { instanceId, destroyedAt };
      },
      (effect) =>
        effect.pipe(
          Effect.scoped,
          Effect.provideService(FetchHttpClient.RequestInit, {
            redirect: "manual",
            credentials: "omit",
          }),
          Effect.timeoutOrElse({
            duration: settings.timeoutMs,
            orElse: () => Effect.fail(new InstancesError({ reason: "timeout" })),
          }),
        ),
    );

    return Service.of({ destroyed });
  }),
);

export const layer = layerNoDeps.pipe(Layer.provide(FetchHttpClient.layer));
export * as Instances from "./instances";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import { Config } from "./config";
import { ConfigError, ControlError } from "./errors";
import { purpose, validateRestricted } from "./policy";
import {
  Resource,
  type Configuration,
  type RawJson,
  type Recovery,
  type RecoveryInput,
  type RestrictedInput,
  type TrustedLaunchInput,
} from "./types";
import * as Wire from "./wire";

export interface Interface {
  readonly validateRestricted: (
    input: RestrictedInput,
  ) => Effect.Effect<Configuration, ConfigError>;
  readonly trustedLaunch: (
    input: TrustedLaunchInput,
  ) => Effect.Effect<Resource, ConfigError | ControlError>;
  readonly recoverByName: (input: string | RecoveryInput) => Effect.Effect<Recovery, ControlError>;
  readonly create: (input: {
    readonly name: string;
    readonly config: RawJson;
  }) => Effect.Effect<Resource, ConfigError | ControlError>;
  readonly fetch: (input: { readonly id: string }) => Effect.Effect<Resource, ControlError>;
  readonly activate: (resource: Resource) => Effect.Effect<Resource, ControlError>;
  readonly stop: (resource: Resource) => Effect.Effect<Resource, ControlError>;
  readonly expire: (resource: Resource) => Effect.Effect<void, ControlError>;
}
export class Service extends Context.Service<Service, Interface>()("@notus/namespace/Service") {}

type Operation = ControlError["operation"];
const maxResponseBytes = 1024 * 1024;
const Identity = Schema.NonEmptyString.check(
  Schema.isMaxLength(256),
  Schema.makeFilter(
    (value) =>
      !Array.from(value).some(
        (char) => /\s/.test(char) || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      ),
  ),
);

export const layerNoDeps = Layer.effect(
  Service,
  Effect.gen(function* () {
    const settings = yield* Config.Service;
    const http = HttpClient.withScope(yield* HttpClient.HttpClient);
    const endpoint = yield* Effect.try({
      try: () => {
        const url = new URL(settings.endpoint ?? Config.defaultEndpoint);
        if (
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
            "Namespace endpoint must be a trusted HTTPS origin without credentials, path, query or fragment",
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

    const rpc = Effect.fn("Namespace.rpc")(
      function* (operation: Operation, body: RawJson) {
        const request = yield* HttpClientRequest.post(
          `${endpoint}/namespace.private.devbox.v1beta.DevBoxService/${operation}`,
        ).pipe(
          HttpClientRequest.setHeader("Connect-Protocol-Version", "1"),
          HttpClientRequest.acceptJson,
          HttpClientRequest.bearerToken(settings.credential),
          HttpClientRequest.bodyJson(body),
          Effect.mapError(
            () => new ControlError({ operation, reason: "invalidInput", outcome: "notSent" }),
          ),
        );
        const response = yield* http
          .execute(request)
          .pipe(
            Effect.mapError(
              () => new ControlError({ operation, reason: "transport", outcome: "unknown" }),
            ),
          );
        if (response.status !== 200) {
          // Never retain provider messages, headers, request bodies or auth-bearing transport causes.
          return yield* new ControlError({
            operation,
            reason: "rejected",
            status: response.status,
            outcome: [400, 401, 403, 404, 405, 415, 422].includes(response.status)
              ? "rejected"
              : "unknown",
          });
        }
        if (
          response.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !==
          "application/json"
        ) {
          return yield* new ControlError({
            operation,
            reason: "invalidResponse",
            outcome: "unknown",
          });
        }
        let size = 0;
        const chunks: Uint8Array[] = [];
        yield* response.stream.pipe(
          Stream.runForEach((chunk) => {
            size += chunk.byteLength;
            if (size > maxResponseBytes)
              return Effect.fail(
                new ControlError({ operation, reason: "invalidResponse", outcome: "unknown" }),
              );
            chunks.push(chunk);
            return Effect.void;
          }),
          Effect.mapError(
            () => new ControlError({ operation, reason: "invalidResponse", outcome: "unknown" }),
          ),
        );
        return yield* Effect.try({
          try: () => {
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) {
              bytes.set(chunk, offset);
              offset += chunk.byteLength;
            }
            return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          },
          catch: () =>
            new ControlError({ operation, reason: "invalidResponse", outcome: "unknown" }),
        }).pipe(
          Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))),
          Effect.mapError(
            () => new ControlError({ operation, reason: "invalidResponse", outcome: "unknown" }),
          ),
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
            orElse: () =>
              Effect.fail(new ControlError({ operation, reason: "timeout", outcome: "unknown" })),
          }),
        ),
    );

    const identity = (operation: Operation, value: string) =>
      Schema.decodeEffect(Identity)(value).pipe(
        Effect.mapError(
          () => new ControlError({ operation, reason: "invalidInput", outcome: "notSent" }),
        ),
      );
    const resource = Effect.fn("Namespace.resource")(function* (
      operation: Operation,
      payload: unknown,
    ) {
      const response = yield* Schema.decodeUnknownEffect(Wire.Response)(payload).pipe(
        Effect.mapError(
          () => new ControlError({ operation, reason: "invalidResponse", outcome: "unknown" }),
        ),
      );
      const box = response.devbox;
      let state: Resource["state"] = "unknown";
      if (box.destroyedAt) state = "expired";
      else if (operation === "Create" || operation === "Stop") state = "stopped";
      else if (response.instanceId) state = "running";
      else if (operation === "Fetch") state = "stopped";
      return Resource.make({
        id: box.id,
        name: box.name,
        ...(response.instanceId ? { instanceId: response.instanceId } : {}),
        state,
        readiness: operation === "Activate" && state === "running" ? "ready" : "unknown",
        ...(box.imageRef || box.resolvedImage
          ? {
              image: {
                ...(box.imageRef ? { ref: box.imageRef } : {}),
                ...box.resolvedImage,
              },
            }
          : {}),
      });
    });
    const fetch = Effect.fn("Namespace.fetch")(function* ({ id }: { readonly id: string }) {
      yield* identity("Fetch", id);
      const result = yield* resource(
        "Fetch",
        yield* rpc("Fetch", { id, returnActivatedInstance: true, includeSshCredentials: false }),
      );
      if (result.id !== id)
        return yield* new ControlError({
          operation: "Fetch",
          reason: "identityMismatch",
          outcome: "unknown",
        });
      return result;
    });
    const verify = Effect.fn("Namespace.verify")(function* (
      operation: Operation,
      stored: Resource,
    ) {
      yield* identity(operation, stored.id);
      yield* identity(operation, stored.name);
      const current = yield* fetch({ id: stored.id });
      if (current.id !== stored.id || current.name !== stored.name) {
        return yield* new ControlError({
          operation,
          reason: "identityMismatch",
          outcome: "notSent",
        });
      }
      return current;
    });
    const checkResult = (operation: Operation, stored: Resource, result: Resource) =>
      result.id === stored.id && result.name === stored.name
        ? Effect.succeed(result)
        : Effect.fail(
            new ControlError({ operation, reason: "identityMismatch", outcome: "unknown" }),
          );

    return Service.of({
      fetch,
      validateRestricted,
      trustedLaunch: Effect.fn("Namespace.trustedLaunch")(function* (input) {
        yield* identity("Create", input.name);
        yield* identity("Create", input.operationId);
        const { raw } = yield* validateRestricted(input);
        yield* Effect.try({
          try: () => {
            const url = new URL(input.bootstrap.controlUrl);
            if (
              url.protocol !== "https:" ||
              url.username ||
              url.password ||
              url.search ||
              url.hash ||
              input.bootstrap.controlUrl.length > 2048 ||
              !input.bootstrap.controlUrl.startsWith("https://") ||
              input.bootstrap.controlUrl.slice(8).split("/")[0]?.includes("@") ||
              /[\s\\\\?#]/.test(input.bootstrap.controlUrl) ||
              !Redacted.isRedacted(input.bootstrap.credential) ||
              !/^[\x21-\x7e]{1,8192}$/.test(Redacted.value(input.bootstrap.credential))
            )
              throw new Error();
          },
          catch: () =>
            new ConfigError({
              message:
                "Bootstrap requires a trusted HTTPS URL without userinfo, query or fragment and a Redacted credential",
            }),
        });
        // Only this boundary builds credential-bearing JSON. Never return or snapshot it.
        const body: RawJson = {
          ...raw,
          name: input.name,
          activate: false,
          versionControl: {},
          accessMode: "USER_PRIVATE",
          privileged: false,
          privateFeatures: [],
          enabledFeatures: [],
          features: { enabled: [] },
          integrations: {},
          documentedPurpose: purpose(input.operationId),
          sessions: [{ name: "notus", command: "exec /usr/local/bin/notus-devbox start" }],
          environment: [
            ...(Array.isArray(raw.environment) ? raw.environment : []),
            { name: "NOTUS_CONTROL_URL", value: input.bootstrap.controlUrl },
            { name: "NOTUS_BOOTSTRAP_TOKEN", value: Redacted.value(input.bootstrap.credential) },
          ],
        };
        const encoded = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Json))(body).pipe(
          Effect.mapError(
            () =>
              new ControlError({ operation: "Create", reason: "invalidInput", outcome: "notSent" }),
          ),
        );
        if (new TextEncoder().encode(encoded).byteLength > maxResponseBytes) {
          return yield* new ControlError({
            operation: "Create",
            reason: "invalidInput",
            outcome: "notSent",
          });
        }
        const result = yield* resource("Create", yield* rpc("Create", body));
        if (result.name !== input.name || result.image?.ref !== raw.imageRef)
          return yield* new ControlError({
            operation: "Create",
            reason: "identityMismatch",
            outcome: "unknown",
          });
        return result;
      }),
      recoverByName: Effect.fn("Namespace.recoverByName")(function* (input) {
        const { name, expectedId, operationId } =
          typeof input === "string" ? { name: input } : input;
        yield* identity("Fetch", name);
        if (expectedId !== undefined) yield* identity("Fetch", expectedId);
        if (operationId !== undefined) yield* identity("Fetch", operationId);
        const payload = yield* rpc("Fetch", {
          name,
          returnActivatedInstance: true,
          includeSshCredentials: false,
        });
        const result = yield* resource("Fetch", payload);
        if (result.name !== name || (expectedId !== undefined && result.id !== expectedId)) {
          return yield* new ControlError({
            operation: "Fetch",
            reason: "identityMismatch",
            outcome: "unknown",
          });
        }
        const response = yield* Schema.decodeUnknownEffect(Wire.Response)(payload).pipe(
          Effect.mapError(
            () =>
              new ControlError({
                operation: "Fetch",
                reason: "invalidResponse",
                outcome: "unknown",
              }),
          ),
        );
        const marker = response.devbox.documentedPurpose;
        return {
          resource: result,
          evidence:
            operationId === undefined || !marker
              ? "insufficientEvidence"
              : marker === purpose(operationId)
                ? "matchingPurpose"
                : "purposeMismatch",
        };
      }),
      create: Effect.fn("Namespace.create")(function* ({ name, config }) {
        yield* identity("Create", name);
        const { raw } = yield* Config.decode(config);
        // Retain future settings in storage without silently executing an unsupported contract.
        if (Object.keys(raw).some((key) => !Object.hasOwn(Wire.CreateSettings.fields, key))) {
          return yield* new ConfigError({
            message:
              "Unsupported top-level CreateRequest setting; execution requires the maintained camelCase contract",
          });
        }
        const result = yield* resource(
          "Create",
          yield* rpc("Create", { ...raw, name, activate: false }),
        );
        if (result.name !== name)
          return yield* new ControlError({
            operation: "Create",
            reason: "identityMismatch",
            outcome: "unknown",
          });
        return result;
      }),
      activate: Effect.fn("Namespace.activate")(function* (stored) {
        yield* verify("Activate", stored);
        const result = yield* resource(
          "Activate",
          yield* rpc("Activate", {
            id: stored.id,
            name: stored.name,
            waitForReadiness: true,
            includeSshCredentials: false,
          }),
        );
        return yield* checkResult("Activate", stored, result);
      }),
      stop: Effect.fn("Namespace.stop")(function* (stored) {
        yield* verify("Stop", stored);
        return yield* checkResult(
          "Stop",
          stored,
          yield* resource("Stop", yield* rpc("Stop", { name: stored.name })),
        );
      }),
      expire: Effect.fn("Namespace.expire")(function* (stored) {
        yield* verify("Expire", stored);
        const response = yield* Schema.decodeUnknownEffect(Wire.ExpireResponse)(
          yield* rpc("Expire", { name: stored.name }),
        ).pipe(
          Effect.mapError(
            () =>
              new ControlError({
                operation: "Expire",
                reason: "invalidResponse",
                outcome: "unknown",
              }),
          ),
        );
        if (
          !response.devboxes?.some((box) => box.id === stored.id && box.name === stored.name) ||
          response.devboxes.some((box) => box.id !== stored.id || box.name !== stored.name)
        ) {
          return yield* new ControlError({
            operation: "Expire",
            reason: "identityMismatch",
            outcome: "unknown",
          });
        }
      }),
    });
  }),
);

export const layer = layerNoDeps.pipe(Layer.provide(FetchHttpClient.layer));
export { validateRestricted } from "./policy";
export * as Namespace from "./service";

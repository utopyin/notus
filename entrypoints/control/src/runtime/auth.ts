import { Bootstrap, Millis, Readiness } from "@notus/executions/types";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

const KeyId = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,48}$/));

export const Capability = Schema.TaggedUnion({
  Enrollment: {
    audience: Schema.NonEmptyString,
    bootstrap: Bootstrap,
    recoveryRevision: Millis,
  },
  Readiness: {
    audience: Schema.NonEmptyString,
    bootstrap: Bootstrap,
    resourceId: Readiness.fields.resourceId,
    instanceId: Readiness.fields.instanceId,
    epoch: Readiness.fields.epoch,
    runId: Readiness.fields.runId,
    challenge: Readiness.fields.challenge,
    expiresAt: Millis,
  },
});
export type Capability = typeof Capability.Type;

export class Failure extends Schema.TaggedError<Failure>()("Runtime.AuthenticationFailure", {
  reason: Schema.Literals(["configuration", "invalid", "expired"]),
}) {}

export class Configuration extends Context.Service<
  Configuration,
  {
    readonly audience: string;
    readonly activeKeyId: string;
    readonly keys: Readonly<Record<string, Redacted.Redacted<string>>>;
  }
>()("@notus/control/Runtime.Authentication.Configuration") {}

export interface Interface {
  readonly issue: (capability: Capability) => Effect.Effect<Redacted.Redacted<string>, Failure>;
  readonly verify: (
    credential: Redacted.Redacted<string>,
    now: number,
  ) => Effect.Effect<Capability, Failure>;
}
export class Service extends Context.Service<Service, Interface>()(
  "@notus/control/Runtime.Authentication",
) {}

const codec = Schema.fromJsonString(Capability);
const invalid = () => new Failure({ reason: "invalid" });
const configuration = () => new Failure({ reason: "configuration" });

const decodeBytes = (value: string) =>
  Effect.fromResult(Base64Url.decode(value)).pipe(Effect.mapError(invalid));

export const disabled = Layer.succeed(
  Service,
  Service.of({
    issue: Effect.fn("Runtime.Authentication.disabledIssue")((_capability: Capability) =>
      Effect.fail(configuration()),
    ),
    verify: Effect.fn("Runtime.Authentication.disabledVerify")(
      (_credential: Redacted.Redacted<string>, _now: number) => Effect.fail(configuration()),
    ),
  }),
);

export const layerNoDeps = Layer.effect(
  Service,
  Effect.gen(function* () {
    const settings = yield* Configuration;

    yield* Schema.decodeEffect(Schema.NonEmptyString)(settings.audience).pipe(
      Effect.mapError(configuration),
    );

    yield* Schema.decodeEffect(KeyId)(settings.activeKeyId).pipe(Effect.mapError(configuration));

    if (!Object.hasOwn(settings.keys, settings.activeKeyId)) return yield* configuration();

    const keys = new Map<string, CryptoKey>();

    for (const [id, secret] of Object.entries(settings.keys)) {
      yield* Schema.decodeEffect(KeyId)(id).pipe(Effect.mapError(configuration));

      if (!Redacted.isRedacted(secret)) return yield* configuration();

      const bytes = yield* decodeBytes(Redacted.value(secret)).pipe(Effect.mapError(configuration));

      if (bytes.byteLength < 32) return yield* configuration();

      const key = yield* Effect.tryPromise({
        try: () =>
          globalThis.crypto.subtle.importKey(
            "raw",
            new Uint8Array(bytes),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign", "verify"],
          ),
        catch: configuration,
      });

      keys.set(id, key);
    }

    return Service.of({
      issue: Effect.fn("Runtime.Authentication.issue")(function* (input) {
        const capability = yield* Schema.decodeEffect(Capability)(input).pipe(
          Effect.mapError(invalid),
        );

        if (capability.audience !== settings.audience) return yield* invalid();

        const key = keys.get(settings.activeKeyId);
        if (!key) return yield* configuration();

        const payload = yield* Schema.encodeEffect(codec)(capability).pipe(
          Effect.mapError(invalid),
        );

        const message = `nr1.${settings.activeKeyId}.${Base64Url.encode(payload)}`;

        if (message.length > 6000) return yield* invalid();

        const signature = yield* Effect.tryPromise({
          try: () => globalThis.crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)),
          catch: invalid,
        });

        return Redacted.make(`${message}.${Base64Url.encode(new Uint8Array(signature))}`);
      }),
      verify: Effect.fn("Runtime.Authentication.verify")(function* (credential, now) {
        if (!Redacted.isRedacted(credential)) return yield* invalid();

        yield* Schema.decodeEffect(Millis)(now).pipe(Effect.mapError(invalid));
        const token = Redacted.value(credential);

        if (token.length > 6200) return yield* invalid();

        const [version, keyId, encoded, signature, ...rest] = token.split(".");

        if (version !== "nr1" || !keyId || !encoded || !signature || rest.length !== 0)
          return yield* invalid();

        yield* Schema.decodeEffect(KeyId)(keyId).pipe(Effect.mapError(invalid));
        const key = keys.get(keyId);
        if (!key) return yield* invalid();

        const bytes = yield* decodeBytes(signature);
        const payload = yield* decodeBytes(encoded);

        if (
          bytes.byteLength !== 32 ||
          Base64Url.encode(bytes) !== signature ||
          Base64Url.encode(payload) !== encoded
        )
          return yield* invalid();

        const matches = yield* Effect.tryPromise({
          try: () =>
            globalThis.crypto.subtle.verify(
              "HMAC",
              key,
              new Uint8Array(bytes),
              new TextEncoder().encode(`nr1.${keyId}.${encoded}`),
            ),
          catch: invalid,
        });
        if (!matches) return yield* invalid();

        const text = yield* Effect.try({
          try: () => new TextDecoder("utf-8", { fatal: true }).decode(payload),
          catch: invalid,
        });

        const capability = yield* Schema.decodeEffect(codec)(text).pipe(Effect.mapError(invalid));

        if (capability.audience !== settings.audience) return yield* invalid();

        if (capability._tag === "Readiness" && capability.expiresAt <= now)
          return yield* new Failure({ reason: "expired" });

        return capability;
      }),
    });
  }),
);
export const layer = layerNoDeps;
export * as Authentication from "./auth";

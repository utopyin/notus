import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

export class SealError extends Schema.TaggedError<SealError>()("Sealed.Error", {
  operation: Schema.Literals(["key", "seal", "open"]),
}) {}

/**
 * Encryption at rest for credentials: AES-256-GCM under one deployment-held key, a fresh nonce per
 * value, the ciphertext written as `v1.<nonce>.<ciphertext>`. Whoever reads the row without the
 * key reads nothing.
 */
export interface Interface {
  readonly seal: (plaintext: string) => Effect.Effect<string, SealError>;
  readonly open: (sealed: string) => Effect.Effect<string, SealError>;
}
export class Service extends Context.Service<Service, Interface>()("@notus/cloudflare/Sealed") {}

const prefix = "v1";

/** The key is 32 bytes, base64; a deployment secret like any other. */
export const layer = (key: Redacted.Redacted<string>) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const bytes = yield* Effect.fromResult(Encoding.decodeBase64(Redacted.value(key))).pipe(
        Effect.mapError(() => new SealError({ operation: "key" })),
      );
      if (bytes.length !== 32) return yield* new SealError({ operation: "key" });
      // Web Crypto wants views over a plain ArrayBuffer; copies keep the types honest.
      const buffer = (view: Uint8Array) => new Uint8Array(view).buffer as ArrayBuffer;
      const aes = yield* Effect.tryPromise({
        try: () =>
          globalThis.crypto.subtle.importKey("raw", buffer(bytes), { name: "AES-GCM" }, false, [
            "encrypt",
            "decrypt",
          ]),
        catch: () => new SealError({ operation: "key" }),
      });
      const seal = Effect.fn("Sealed.seal")(function* (plaintext: string) {
        const nonce = globalThis.crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = yield* Effect.tryPromise({
          try: () =>
            globalThis.crypto.subtle.encrypt(
              { name: "AES-GCM", iv: nonce },
              aes,
              buffer(new TextEncoder().encode(plaintext)),
            ),
          catch: () => new SealError({ operation: "seal" }),
        });
        return `${prefix}.${Encoding.encodeBase64Url(nonce)}.${Encoding.encodeBase64Url(new Uint8Array(ciphertext))}`;
      });
      const open = Effect.fn("Sealed.open")(function* (sealed: string) {
        const [version, nonce, ciphertext] = sealed.split(".");
        if (version !== prefix || nonce === undefined || ciphertext === undefined)
          return yield* new SealError({ operation: "open" });
        const iv = yield* Effect.fromResult(Encoding.decodeBase64Url(nonce)).pipe(
          Effect.mapError(() => new SealError({ operation: "open" })),
        );
        const data = yield* Effect.fromResult(Encoding.decodeBase64Url(ciphertext)).pipe(
          Effect.mapError(() => new SealError({ operation: "open" })),
        );
        const plaintext = yield* Effect.tryPromise({
          try: () =>
            globalThis.crypto.subtle.decrypt(
              { name: "AES-GCM", iv: buffer(iv) },
              aes,
              buffer(data),
            ),
          catch: () => new SealError({ operation: "open" }),
        });
        return new TextDecoder().decode(plaintext);
      });
      return Service.of({ seal, open });
    }),
  );

export * as Sealed from "./sealed";

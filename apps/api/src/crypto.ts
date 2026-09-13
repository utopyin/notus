import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";

/** Worker Web Crypto, without Node platform imports. */
export const cryptoLayer = Layer.sync(Crypto.Crypto, () =>
  Crypto.make({
    randomBytes: (size) => {
      const bytes = new Uint8Array(size);
      // Web Crypto limits each getRandomValues call to 65,536 bytes.
      for (let offset = 0; offset < size; offset += 65_536) {
        globalThis.crypto.getRandomValues(bytes.subarray(offset, offset + 65_536));
      }
      return bytes;
    },
    digest: (algorithm, data) =>
      Effect.tryPromise({
        try: () => globalThis.crypto.subtle.digest(algorithm, new Uint8Array(data)),
        catch: (cause) =>
          PlatformError.systemError({
            _tag: "Unknown",
            module: "Crypto",
            method: "digest",
            cause,
          }),
      }).pipe(Effect.map((buffer) => new Uint8Array(buffer))),
  }),
);

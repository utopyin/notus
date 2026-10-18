import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export class InvalidJson extends Schema.TaggedError<InvalidJson>()("Contracts.InvalidJson", {}) {}

// Inspect descriptors, never property values through caller-controlled getters.
// The active path rejects cycles but permits repeated references to JSON data.
const clone = (value: unknown, active: Set<object>): Schema.Json => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || value === null || active.has(value)) throw new InvalidJson({});

  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);

  if (
    array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null
  ) {
    throw new InvalidJson({});
  }

  const keys = Reflect.ownKeys(value);
  const length = array ? Object.getOwnPropertyDescriptor(value, "length")?.value : undefined;

  if (array && keys.length !== length + 1) throw new InvalidJson({});

  active.add(value);
  const result: Array<Schema.Json> | { [key: string]: Schema.Json } = array ? [] : {};

  for (const key of keys) {
    if (array && key === "length") continue;

    const property = Object.getOwnPropertyDescriptor(value, key);

    if (
      typeof key !== "string" ||
      property === undefined ||
      !property.enumerable ||
      !("value" in property) ||
      (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length))
    ) {
      throw new InvalidJson({});
    }

    // defineProperty preserves __proto__ and constructor as ordinary JSON keys.
    Object.defineProperty(result, key, {
      value: clone(property.value, active),
      enumerable: true,
      writable: false,
      configurable: false,
    });
  }

  active.delete(value);

  return Object.freeze(result);
};

/** Validate and detach JSON data before native decoding or serialization. No hooks are called. */
export const snapshot = Effect.fn("Json.snapshot")(function* (
  input: unknown,
): Effect.fn.Return<Schema.Json, InvalidJson> {
  return yield* Effect.try({
    try: () => clone(input, new Set()),
    catch: () => new InvalidJson({}),
  });
});

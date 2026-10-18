/** Plain JSON, as the API stores and returns it. */
export type Json =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<Json>
  | { readonly [key: string]: Json };
export type JsonObject = { readonly [key: string]: Json };

export const isObject = (value: Json | undefined): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The same text for the same document, whatever order its keys were written in. */
export const canonical = (value: Json | undefined): string => {
  if (value === undefined) return "";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;

  if (isObject(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;

  return JSON.stringify(value);
};

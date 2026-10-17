import * as Schema from "effect/Schema";

/**
 * The systems a workspace may run its devboxes on. This is the single definition every column,
 * form and registration derives from. Append-only.
 */
export const Provider = Schema.Literals(["namespace", "boat"]);
export type Provider = typeof Provider.Type;

/** The literal values as a tuple, for consumers that need the list rather than the schema. */
export const PROVIDERS = Provider.literals;

import * as Schema from "effect/Schema";

/**
 * The systems Notus receives human input from and answers in. This is the single definition every
 * column, key and client derives from; a value that exists here and nowhere else is what stops
 * parallel unions from growing back. Append-only.
 */
export const Platform = Schema.Literals(["slack", "github"]);
export type Platform = typeof Platform.Type;

/** The literal values as a tuple, for consumers that need the list rather than the schema. */
export const PLATFORMS = Platform.literals;

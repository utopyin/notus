import * as Schema from "effect/Schema";

/**
 * The systems Notus receives human input from and answers in. This is the single definition every
 * column, key and client derives from. Append-only.
 */
export const Platform = Schema.Literals(["slack", "github"]);
export type Platform = typeof Platform.Type;

/** The literal values as a tuple. */
export const PLATFORMS = Platform.literals;

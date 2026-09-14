import { Actor } from "@notus/contracts/source";
import * as Schema from "effect/Schema";

export const Fixture = Schema.Struct({ actor: Actor, userId: Schema.NonEmptyString });
export interface Fixture extends Schema.Schema.Type<typeof Fixture> {}

/** A dashboard sign-in and the identities its providers verified. */
export const Login = Schema.Struct({
  authUserId: Schema.NonEmptyString,
  actors: Schema.Array(Actor),
  now: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export interface Login extends Schema.Schema.Type<typeof Login> {}

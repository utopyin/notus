import { Actor } from "@notus/platform/source";
import * as Schema from "effect/Schema";

/** A dashboard sign-in and the identities its providers verified. */
export const Profile = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
  image: Schema.NullOr(Schema.String),
  /** Known once the user signed in with GitHub; a Slack-only sign-in leaves the stored one alone. */
  githubLogin: Schema.NullOr(Schema.String),
});
export interface Profile extends Schema.Schema.Type<typeof Profile> {}
export const Login = Schema.Struct({
  authUserId: Schema.NonEmptyString,
  actors: Schema.Array(Actor),
  profile: Profile,
  now: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export interface Login extends Schema.Schema.Type<typeof Login> {}

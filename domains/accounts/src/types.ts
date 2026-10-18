import { Actor } from "@notus/platform/source";
import { Provider } from "@notus/openai/types";
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

const Millis = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** A model connection as its owner sees it: status only, never material. */
export const ConnectionStatus = Schema.Struct({
  userId: Schema.NonEmptyString,
  provider: Provider,
  linked: Schema.Boolean,
  accountId: Schema.NullOr(Schema.NonEmptyString),
  expiresAt: Schema.NullOr(Millis),
  linkedAt: Schema.NullOr(Millis),
  rotatedAt: Schema.NullOr(Millis),
  revokedAt: Schema.NullOr(Millis),
  /** Hash of the explicit seed that supplied the material; never the material itself. */
  seedFingerprint: Schema.NullOr(Schema.NonEmptyString),
});
export interface ConnectionStatus extends Schema.Schema.Type<typeof ConnectionStatus> {}
/** Where a device-code sign-in stands; the code and page are what the person needs to finish it. */
export const DeviceLogin = Schema.Union([
  Schema.Struct({
    state: Schema.Literal("pending"),
    userCode: Schema.NonEmptyString,
    verificationUrl: Schema.NonEmptyString,
    expiresAt: Millis,
    /** Seconds until the next poll makes sense. */
    interval: Schema.Int,
  }),
  Schema.Struct({ state: Schema.Literal("linked"), connection: ConnectionStatus }),
  Schema.Struct({ state: Schema.Literal("expired") }),
  Schema.Struct({ state: Schema.Literal("none") }),
]);
export type DeviceLogin = typeof DeviceLogin.Type;

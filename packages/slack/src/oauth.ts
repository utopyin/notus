import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

export class OAuthError extends Schema.TaggedError<OAuthError>()("Slack.OAuthError", {
  reason: Schema.Literals(["transport", "rejected", "invalid-response"]),
  /** Slack's error slug, such as `bad_redirect_uri` or `invalid_code`. */
  code: Schema.optionalKey(Schema.String),
}) {}

/** What "Add to Slack" yields: the team, and the bot the app now is there. */
export const Grant = Schema.Struct({
  teamId: Schema.NonEmptyString,
  teamName: Schema.String,
  botUserId: Schema.NonEmptyString,
  botToken: Schema.NonEmptyString,
});
export interface Grant extends Schema.Schema.Type<typeof Grant> {}

const AccessResponse = Schema.Struct({
  ok: Schema.Boolean,
  error: Schema.optionalKey(Schema.String),
  access_token: Schema.optionalKey(Schema.String),
  bot_user_id: Schema.optionalKey(Schema.String),
  team: Schema.optionalKey(
    Schema.Struct({ id: Schema.String, name: Schema.optionalKey(Schema.String) }),
  ),
});

/** The bot scopes Notus asks for when installed: read mentions and channels, post and react. */
export const scopes = [
  "app_mentions:read",
  "channels:history",
  "channels:read",
  "chat:write",
  "groups:history",
  "groups:read",
  "reactions:write",
] as const;

export const authorizeUrl = (input: {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
}) => {
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("scope", scopes.join(","));
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);

  return url.toString();
};

/** oauth.v2.access: one code for one bot token. The token is returned redacted and never logged. */
export const exchange = Effect.fn("Slack.OAuth.exchange")(
  function* (input: {
    readonly clientId: string;
    readonly clientSecret: Redacted.Redacted<string>;
    readonly code: string;
    readonly redirectUri: string;
  }) {
    const http = yield* HttpClient.HttpClient;

    // Form-encoded, as Slack requires; bodyUrlParams sets the content type with the body.
    const request = HttpClientRequest.post("https://slack.com/api/oauth.v2.access").pipe(
      HttpClientRequest.bodyUrlParams({
        client_id: input.clientId,
        client_secret: Redacted.value(input.clientSecret),
        code: input.code,
        redirect_uri: input.redirectUri,
      }),
    );

    const response = yield* http
      .execute(request)
      .pipe(Effect.mapError(() => new OAuthError({ reason: "transport" })));
    const json = yield* response.json.pipe(
      Effect.mapError(() => new OAuthError({ reason: "invalid-response" })),
    );

    const decoded = yield* Schema.decodeUnknownEffect(AccessResponse)(json).pipe(
      Effect.mapError(() => new OAuthError({ reason: "invalid-response" })),
    );

    if (!decoded.ok)
      return yield* new OAuthError({
        reason: "rejected",
        ...(decoded.error === undefined ? {} : { code: decoded.error }),
      });

    if (!decoded.access_token || !decoded.bot_user_id || !decoded.team)
      return yield* new OAuthError({ reason: "invalid-response" });

    return Grant.make({
      teamId: decoded.team.id,
      teamName: decoded.team.name ?? decoded.team.id,
      botUserId: decoded.bot_user_id,
      botToken: decoded.access_token,
    });
  },
  Effect.scoped,
  Effect.timeoutOrElse({
    duration: "15 seconds",
    orElse: () => Effect.fail(new OAuthError({ reason: "transport" })),
  }),
);
export * as OAuth from "./oauth";

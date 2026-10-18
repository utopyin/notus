import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

export class InvalidSignature extends Schema.TaggedError<InvalidSignature>()(
  "GitHub.InvalidSignature",
  {},
) {}
export class InvalidEnvelope extends Schema.TaggedError<InvalidEnvelope>()(
  "GitHub.InvalidEnvelope",
  {},
) {}

const User = Schema.Struct({ login: Schema.NonEmptyString, type: Schema.String });
const ViaApp = Schema.optionalKey(Schema.NullOr(Schema.Struct({ id: Schema.Int })));

const Repository = Schema.Struct({
  name: Schema.NonEmptyString,
  owner: Schema.Struct({ login: Schema.NonEmptyString }),
});
const Installation = Schema.Struct({ id: Schema.Int });
const Pull = Schema.Struct({
  number: Schema.Int,
  body: Schema.NullOr(Schema.String),
  created_at: Schema.NonEmptyString,
});
const IssueComment = Schema.Struct({
  action: Schema.String,
  issue: Schema.Struct({
    number: Schema.Int,
    body: Schema.NullOr(Schema.String),
    created_at: Schema.NonEmptyString,
    pull_request: Schema.optionalKey(Schema.Unknown),
  }),
  comment: Schema.Struct({
    id: Schema.Int,
    body: Schema.String,
    user: User,
    created_at: Schema.NonEmptyString,
    performed_via_github_app: ViaApp,
  }),
  repository: Repository,
  installation: Installation,
});
const ReviewComment = Schema.Struct({
  action: Schema.String,
  pull_request: Pull,
  comment: Schema.Struct({
    id: Schema.Int,
    path: Schema.String,
    line: Schema.optionalKey(Schema.NullOr(Schema.Int)),
    original_line: Schema.optionalKey(Schema.NullOr(Schema.Int)),
    body: Schema.String,
    user: User,
    created_at: Schema.NonEmptyString,
    performed_via_github_app: ViaApp,
  }),
  repository: Repository,
  installation: Installation,
});
const Review = Schema.Struct({
  action: Schema.String,
  pull_request: Pull,
  review: Schema.Struct({
    id: Schema.Int,
    body: Schema.NullOr(Schema.String),
    user: User,
    submitted_at: Schema.NullOr(Schema.String),
    performed_via_github_app: ViaApp,
  }),
  repository: Repository,
  installation: Installation,
});

export const TargetKind = Schema.Literals(["issue-comment", "review-comment", "review"]);
export type TargetKind = typeof TargetKind.Type;

/** One human-authored piece of pull request feedback, before any authorization. */
export interface Feedback {
  readonly deliveryId: string;
  readonly installationId: string;
  readonly repository: { readonly owner: string; readonly name: string };
  readonly pullNumber: number;
  readonly pullCreatedAt: string;
  readonly target: { readonly kind: TargetKind; readonly id: string };
  readonly author: { readonly login: string; readonly type: string };
  readonly viaAppId: number | null;
  readonly body: string;
  readonly createdAt: string;
  /** The file and line a review comment is attached to; null for conversation comments and reviews. */
  readonly location: { readonly path: string; readonly line: number | null } | null;
}
export type Decoded =
  | { readonly type: "feedback"; readonly feedback: Feedback }
  | { readonly type: "ping" }
  | { readonly type: "ignored"; readonly reason: string };

/** Verify untouched request bytes against X-Hub-Signature-256 with constant-time HMAC. */
export const verify = Effect.fn("GitHub.verify")(function* (
  rawBody: Uint8Array,
  signature: string | null,
  secret: Redacted.Redacted<string>,
): Effect.fn.Return<void, InvalidSignature> {
  if (signature === null || !/^sha256=[a-f0-9]{64}$/.test(signature))
    return yield* new InvalidSignature({});

  const digest = new Uint8Array(32);

  for (let index = 0; index < digest.length; index++)
    digest[index] = Number.parseInt(signature.slice(7 + index * 2, 9 + index * 2), 16);

  const key = yield* Effect.tryPromise({
    try: () =>
      crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(Redacted.value(secret)),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"],
      ),
    catch: () => new InvalidSignature({}),
  });
  const valid = yield* Effect.tryPromise({
    try: () => crypto.subtle.verify("HMAC", key, digest, new Uint8Array(rawBody)),
    catch: () => new InvalidSignature({}),
  });
  if (!valid) return yield* new InvalidSignature({});
});

const text = (rawBody: Uint8Array) =>
  Effect.try({
    try: () => new TextDecoder("utf-8", { fatal: true }).decode(rawBody),
    catch: () => new InvalidEnvelope({}),
  });

/** Decode only after verify succeeds. Anything but new human feedback on a pull request is ignored. */
export const decode = Effect.fn("GitHub.decode")(function* (
  eventName: string | null,
  deliveryId: string | null,
  rawBody: Uint8Array,
): Effect.fn.Return<Decoded, InvalidEnvelope> {
  if (eventName === null || deliveryId === null || !/^[A-Za-z0-9-]{1,100}$/.test(deliveryId))
    return yield* new InvalidEnvelope({});

  if (eventName === "ping") return { type: "ping" };

  const value = yield* Effect.flatMap(text(rawBody), (body) =>
    Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(body).pipe(
      Effect.mapError(() => new InvalidEnvelope({})),
    ),
  );

  const decodeAs = <A, I>(schema: Schema.Codec<A, I>) =>
    Schema.decodeUnknownEffect(schema)(value).pipe(Effect.mapError(() => new InvalidEnvelope({})));

  switch (eventName) {
    case "issue_comment": {
      const event = yield* decodeAs(IssueComment);

      if (event.action !== "created") return { type: "ignored", reason: "action" };
      if (event.issue.pull_request === undefined) return { type: "ignored", reason: "not-a-pull" };

      return {
        type: "feedback",
        feedback: {
          deliveryId,
          installationId: String(event.installation.id),
          repository: { owner: event.repository.owner.login, name: event.repository.name },
          pullNumber: event.issue.number,
          pullCreatedAt: event.issue.created_at,
          target: { kind: "issue-comment", id: String(event.comment.id) },
          author: event.comment.user,
          viaAppId: event.comment.performed_via_github_app?.id ?? null,
          body: event.comment.body,
          createdAt: event.comment.created_at,
          location: null,
        },
      };
    }
    case "pull_request_review_comment": {
      const event = yield* decodeAs(ReviewComment);
      if (event.action !== "created") return { type: "ignored", reason: "action" };

      return {
        type: "feedback",
        feedback: {
          deliveryId,
          installationId: String(event.installation.id),
          repository: { owner: event.repository.owner.login, name: event.repository.name },
          pullNumber: event.pull_request.number,
          pullCreatedAt: event.pull_request.created_at,
          target: { kind: "review-comment", id: String(event.comment.id) },
          author: event.comment.user,
          viaAppId: event.comment.performed_via_github_app?.id ?? null,
          body: event.comment.body,
          createdAt: event.comment.created_at,
          location: {
            path: event.comment.path,
            line: event.comment.line ?? event.comment.original_line ?? null,
          },
        },
      };
    }
    case "pull_request_review": {
      const event = yield* decodeAs(Review);

      if (event.action !== "submitted") return { type: "ignored", reason: "action" };

      const body = event.review.body ?? "";

      // An approval or request-changes without text carries nothing to answer.
      if (body.trim() === "" || event.review.submitted_at === null)
        return { type: "ignored", reason: "empty-review" };

      return {
        type: "feedback",
        feedback: {
          deliveryId,
          installationId: String(event.installation.id),
          repository: { owner: event.repository.owner.login, name: event.repository.name },
          pullNumber: event.pull_request.number,
          pullCreatedAt: event.pull_request.created_at,
          target: { kind: "review", id: String(event.review.id) },
          author: event.review.user,
          viaAppId: event.review.performed_via_github_app?.id ?? null,
          body,
          createdAt: event.review.submitted_at,
          location: null,
        },
      };
    }
    default:
      return { type: "ignored", reason: "event" };
  }
});

/** The platform's ordered timestamp from an ISO instant. */
export const orderedTimestamp = (iso: string): string | null => {
  const millis = Date.parse(iso);
  if (!Number.isFinite(millis) || millis < 0) return null;
  return `${Math.floor(millis / 1000)}.${String((millis % 1000) * 1000).padStart(6, "0")}`;
};

export * as Webhooks from "./webhooks";

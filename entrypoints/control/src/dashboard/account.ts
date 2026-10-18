import { Workspaces } from "@notus/workspaces/workspaces";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ConnectionObject } from "../objects/connection";
import { AccountRpcs, MeRpcs, Viewer } from "./rpcs";
import { Sessions } from "./sessions";
import { Viewers, refusal, refuse } from "./viewers";

/** Who is signed in, for anyone: an anonymous call gets null. */
export const me = MeRpcs.toLayer(
  Effect.gen(function* () {
    const viewers = yield* Viewers.Service;
    const workspaces = yield* Workspaces.Service;

    return {
      me: (_, { headers }) =>
        Effect.gen(function* () {
          const me = yield* viewers.resolve(headers.cookie ?? "");
          if (me === null) return null;

          const mine = yield* workspaces.listMine(me.userId);
          const user = me.session.user;

          return {
            user: {
              id: me.userId,
              name: user.name,
              email: user.email,
              image: user.image,
              slackTeamId: user.slackTeamId,
            },
            accounts: me.session.accounts.map((account) => ({
              id: account.id,
              provider: account.providerId,
              accountId: account.accountId,
              createdAt: account.createdAt.toISOString(),
            })),
            workspaces: mine.map((w) => ({ id: w.id, name: w.name, slug: w.slug, role: w.role })),
          };
        }).pipe(
          Effect.tapError((error) => Effect.logWarning(`dashboard.me_failed ${error._tag}`)),
          Effect.orElseSucceed(() => null),
        ),
    };
  }),
);

/** One call on the user's own Connection object, its refusal turned into the dashboard's. */
const own = <A>(
  result: Effect.Effect<
    { readonly ok: true; readonly value: A } | { readonly ok: false; readonly reason: string }
  >,
) =>
  Effect.flatMap(result, (outcome) =>
    outcome.ok ? Effect.succeed(outcome.value) : refusal(outcome.reason),
  );

const fingerprint = (key: string) =>
  Effect.tryPromise({
    try: () => globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)),
    catch: () => ({ _tag: "Digest", reason: "failed" }),
  }).pipe(
    Effect.map((digest) =>
      Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join(""),
    ),
  );

/** The user's sessions and model connections: status projections, never tokens or material. */
export const account = AccountRpcs.toLayer(
  Effect.gen(function* () {
    const sessions = yield* Sessions.Service;
    const connections = yield* ConnectionObject.Remote;

    return {
      sessions: () =>
        Effect.gen(function* () {
          const me = yield* Viewer;
          const listed = yield* sessions.list(me.cookie);

          return listed
            .map((session) => ({
              id: session.id,
              createdAt: session.createdAt.toISOString(),
              userAgent: session.userAgent,
              current: session.id === me.sessionId,
            }))
            .sort((a, b) =>
              a.current ? -1 : b.current ? 1 : b.createdAt.localeCompare(a.createdAt),
            );
        }).pipe(refuse),
      /** The token never leaves the API: revocation goes by the session's ID. */
      revokeSession: ({ sessionId }) =>
        Effect.gen(function* () {
          const me = yield* Viewer;
          if (!(yield* sessions.revoke(me.cookie, sessionId))) return yield* refusal("not-found");
        }).pipe(refuse),
      connections: () =>
        Effect.flatMap(Viewer, (me) => own(connections(me.userId).status(me.userId))),
      beginChatGpt: () =>
        Effect.flatMap(Viewer, (me) => own(connections(me.userId).beginDeviceLogin(me.userId))),
      /** One poll of the issuer; links the login once the person finished on the verification page. */
      pollChatGpt: () =>
        Effect.flatMap(Viewer, (me) => own(connections(me.userId).pollDeviceLogin(me.userId))),
      linkApiKey: ({ key }) =>
        Effect.gen(function* () {
          const me = yield* Viewer;
          const trimmed = key.trim();

          if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(trimmed)) return yield* refusal("invalid-input");

          const digest = yield* fingerprint(trimmed);

          return yield* own(
            connections(me.userId).link(me.userId, {
              userId: me.userId,
              provider: "openai-api",
              key: trimmed,
              fingerprint: `openai-api:${digest}`,
            }),
          );
        }).pipe(refuse),
      revokeConnection: ({ provider }) =>
        Effect.flatMap(Viewer, (me) => own(connections(me.userId).revoke(me.userId, provider))),
    };
  }),
);

export const layer = Layer.mergeAll(me, account);

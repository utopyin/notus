import { Identities } from "@notus/accounts/identities";
import { InstallationId, PlatformId } from "@notus/platform/ids";
import type { Actor } from "@notus/platform/source";
import { RuntimeContext } from "alchemy/RuntimeContext";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { Authentication, DashboardError, Execution, Viewer } from "./rpcs";
import { Sessions } from "./sessions";

/**
 * Resolves the signed-in dashboard user from the forwarded cookie: the session, its linked
 * provider accounts as verified identities, and the canonical Notus user those identities adopt.
 * Anonymous requests yield null; nothing here is trusted from the caller.
 */
const make = Effect.gen(function* () {
  const sessions = yield* Sessions.Service;
  const identities = yield* Identities.Service;

  const resolve = Effect.fn("Viewer.resolve")(function* (cookie: string) {
    const session = yield* sessions.signIn(cookie);
    if (session === null) return null;

    const actors: Array<Actor> = [];

    for (const account of session.accounts) {
      if (account.providerId === "slack" && session.user.slackTeamId)
        actors.push({
          platform: "slack",
          installationId: InstallationId.make(session.user.slackTeamId),
          externalId: PlatformId.make(account.accountId),
        });

      if (account.providerId === "github")
        actors.push({
          platform: "github",
          installationId: InstallationId.make("oauth"),
          externalId: PlatformId.make(account.accountId),
        });
    }

    const now = yield* Clock.currentTimeMillis;

    const userId = yield* identities.adopt({
      authUserId: session.user.id,
      actors,
      profile: {
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
        githubLogin: session.user.githubLogin,
      },
      now,
    });

    return { session, userId, now };
  });

  return { resolve };
});

export class Service extends Context.Service<Service>()("@notus/control/dashboard/Viewers", {
  make,
}) {}

export const layer = Layer.effect(Service, Service.make);

const unauthorized = new DashboardError({ reason: "unauthorized" });

/**
 * The runtime context of the request a call arrived on. The RPC server runs each call in the
 * fiber of its HTTP request and merges that fiber's services into the handler's, so the context
 * is there; the middlewares below are where the types learn it. A call without one is a defect.
 */
const requestRuntime = Effect.flatMap(Effect.serviceOption(RuntimeContext), (runtime) =>
  Option.isSome(runtime)
    ? Effect.succeed(runtime.value)
    : Effect.die(new Error("A dashboard call ran outside a request")),
);

/** Hands the request's runtime context to a call that needs no session. */
export const execution = Layer.succeed(Execution, (effect) =>
  Effect.flatMap(requestRuntime, (runtime) =>
    Effect.provideService(effect, RuntimeContext, runtime),
  ),
);

/** The session middleware: every authenticated call acts for the user its cookie resolves to. */
export const authentication = Layer.effect(
  Authentication,
  Effect.gen(function* () {
    const viewers = yield* Service;

    const middleware: Authentication["Service"] = (effect, { headers }) =>
      Effect.gen(function* () {
        const cookie = headers.cookie ?? "";
        const runtime = yield* requestRuntime;

        const me = yield* viewers.resolve(cookie).pipe(
          Effect.provideService(RuntimeContext, runtime),
          Effect.tapError((error) => Effect.logWarning(`dashboard.session_failed ${error._tag}`)),
          Effect.mapError(() => unauthorized),
        );

        if (me === null) return yield* unauthorized;

        return yield* effect.pipe(
          Effect.provideService(Viewer, {
            userId: me.userId,
            sessionId: me.session.sessionId,
            cookie,
            now: me.now,
          }),
          Effect.provideService(RuntimeContext, runtime),
        );
      });

    return middleware;
  }),
);

/** Any refusal as the dashboard sees it: its reason when it has one, logged with its tag. */
export const refuse = <A, E extends { readonly _tag: string }, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.catch((error) => {
      const reason =
        "reason" in error && typeof error.reason === "string" ? error.reason : "failed";

      return Effect.logWarning(`dashboard.rpc_failed ${error._tag} ${reason}`).pipe(
        Effect.andThen(Effect.fail(new DashboardError({ reason }))),
      );
    }),
  );

/** A refusal decided here, with the reason the dashboard shows. */
export const refusal = (reason: string) => Effect.fail(new DashboardError({ reason }));

export * as Viewers from "./viewers";

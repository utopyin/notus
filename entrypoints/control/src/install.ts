import { Platform } from "@notus/platform/platform";
import { Platforms } from "@notus/platforms/registry";
import { apiOriginOf } from "@notus/shared/hosts";
import { Workspaces } from "@notus/workspaces/workspaces";
import { dashboardConfig } from "./config";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

/** Where a platform sends the administrator back: this Worker's own route for that platform. */
export const redirectUriOf = (dashboardOrigin: string, platform: Platform) =>
  `${apiOriginOf(dashboardOrigin)}/platforms/${platform}/install`;

const redirect = (location: string) =>
  HttpServerResponse.empty({ status: 302, headers: { location } });

/**
 * The platform's redirect after an administrator installed it, at `GET /platforms/<platform>/install`
 * on this Worker's public origin. The session cookie lives on the dashboard's origin, so the request
 * moves there unchanged; the dashboard hands it back with the cookie through `complete`.
 */
export const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const origin = (yield* dashboardConfig).origin;

    yield* router.add(
      "GET",
      "/platforms/:platform/install",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const { platform } = yield* HttpRouter.params;

        if (origin === null || !Schema.is(Platform)(platform))
          return HttpServerResponse.empty({ status: 404 });

        const search = new URL(request.url, "https://notus.invalid").search;

        return redirect(`${origin}/platforms/${platform}/install${search}`);
      }),
    );
  }),
);

/**
 * Completes an install for the signed-in user. The nonce names the intent, which only the user
 * who began it may complete: anyone else holding the platform's redirect gets nothing. The
 * adapter turns the rest of the query into an installation; the workspace records it. Every
 * outcome is a dashboard location, with a reason when nothing was installed.
 */
export const complete = (
  dashboardOrigin: string,
  userId: string,
  platform: string,
  search: string,
) =>
  Effect.gen(function* () {
    const platforms = yield* Platforms.Service;
    const workspaces = yield* Workspaces.Service;
    const home = `${dashboardOrigin}/`;

    if (!Schema.is(Platform)(platform)) return `${home}?install=wrong-platform`;

    const query = new URLSearchParams(search);
    const state = query.get("state");
    if (!state) return `${home}?install=missing-state`;

    const now = yield* Clock.currentTimeMillis;

    const intent = yield* workspaces
      .takeInstallIntent(state, now)
      .pipe(Effect.mapError(() => "expired-intent" as const));

    if (intent.platform !== platform) return `${home}?install=wrong-platform`;
    if (intent.userId !== userId) return `${home}?install=wrong-user`;

    const view = yield* workspaces
      .view(intent.workspaceId, intent.userId)
      .pipe(Effect.mapError(() => "unknown-workspace" as const));

    const back = `${dashboardOrigin}/${view.workspace.slug}/platforms/${platform}`;

    if (query.get("error"))
      return `${back}?install=${encodeURIComponent(query.get("error") ?? "")}`;

    const scope = yield* platforms
      .forPlatform(platform)
      .pipe(Effect.mapError(() => "unregistered" as const));
    const installed = yield* scope.installing
      .complete(
        { state, redirectUri: redirectUriOf(dashboardOrigin, platform), userId: intent.userId },
        query,
      )
      .pipe(
        Effect.mapError(
          (error) =>
            `${platform} ${error.reason}${error.detail === undefined ? "" : ` (${error.detail})`}`,
        ),
      );

    yield* workspaces
      .install(intent, installed, now)
      .pipe(Effect.mapError((error) => `${platform} ${error.reason}`));

    yield* Effect.logInfo(`install.completed ${platform}`);

    return `${back}?installed=${platform}`;
  }).pipe(
    Effect.catch((reason) =>
      Effect.logWarning(`install.failed ${String(reason)}`).pipe(
        Effect.as(`${dashboardOrigin}/?install=${encodeURIComponent(String(reason))}`),
      ),
    ),
  );

import { Platform } from "@notus/platform/platform";
import { Platforms } from "@notus/platforms/registry";
import { apiOriginOf } from "@notus/stages/hosts";
import { Workspaces } from "@notus/workspaces/workspaces";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

/** Where a platform sends the administrator back: this Worker's own route for that platform. */
export const redirectUriOf = (dashboardOrigin: string, platform: Platform) =>
  `${apiOriginOf(dashboardOrigin)}/platforms/${platform}/install`;

const redirect = (location: string) =>
  HttpServerResponse.empty({ status: 302, headers: { location } });

/**
 * The platform's redirect after an administrator installed it. The nonce it carries names the
 * intent; the adapter turns the rest of the query into an installation; the workspace records it.
 * Every outcome lands on the dashboard, with a reason when nothing was installed.
 */
export const callback = (dashboardOrigin: string) =>
  Effect.gen(function* () {
    const platforms = yield* Platforms.Service;
    const workspaces = yield* Workspaces.Service;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = new URL(request.url, "https://notus.invalid");
    const platform = /^\/platforms\/([a-z]+)\/install$/.exec(url.pathname)?.[1];
    if (request.method !== "GET" || platform === undefined || !Schema.is(Platform)(platform))
      return HttpServerResponse.empty({ status: 404 });
    const home = `${dashboardOrigin}/`;
    const state = url.searchParams.get("state");
    if (!state) return redirect(`${home}?install=missing-state`);
    const now = yield* Clock.currentTimeMillis;
    const intent = yield* workspaces
      .takeInstallIntent(state, now)
      .pipe(Effect.mapError(() => "expired-intent" as const));
    if (intent.platform !== platform) return redirect(`${home}?install=wrong-platform`);
    const view = yield* workspaces
      .view(intent.workspaceId, intent.userId)
      .pipe(Effect.mapError(() => "unknown-workspace" as const));
    const back = `${dashboardOrigin}/${view.workspace.slug}/platforms/${platform}`;
    if (url.searchParams.get("error"))
      return redirect(`${back}?install=${encodeURIComponent(url.searchParams.get("error") ?? "")}`);
    const scope = yield* platforms
      .forPlatform(platform)
      .pipe(Effect.mapError(() => "unregistered" as const));
    const installed = yield* scope.installing
      .complete({ state, redirectUri: redirectUriOf(dashboardOrigin, platform) }, url.searchParams)
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
    return redirect(`${back}?installed=${platform}`);
  }).pipe(
    Effect.catch((reason) =>
      Effect.logWarning(`install.failed ${String(reason)}`).pipe(
        Effect.as(redirect(`${dashboardOrigin}/?install=${encodeURIComponent(String(reason))}`)),
      ),
    ),
  );

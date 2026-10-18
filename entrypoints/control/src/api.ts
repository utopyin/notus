import { Identities } from "@notus/accounts/identities";
import { Sealed } from "@notus/cloudflare/sealed";
import { InstallError } from "@notus/platform/installing";
import { Compute } from "@notus/workspaces/compute";
import { Credentials } from "@notus/workspaces/credentials";
import { Environments } from "@notus/workspaces/environments";
import { Roles } from "@notus/workspaces/roles";
import { Templates } from "@notus/workspaces/templates";
import { Workspaces } from "@notus/workspaces/workspaces";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import {
  credentialKeyConfig,
  dashboardConfig,
  deploymentConfig,
  githubConfig,
  runtimeConfig,
  webhookConfig,
} from "./config";
import { cryptoLayer } from "./crypto";
import * as Dashboard from "./dashboard/server";
import { Viewers } from "./dashboard/viewers";
import { authentication } from "./devbox";
import { Drain } from "./drain";
import { Inbox } from "./inbox";
import * as Ingress from "./ingress";
import * as Install from "./install";
import { ConnectionObject } from "./objects/connection";
import { platformsLayer } from "./platforms";
import * as Callback from "./runtime/callback";

/**
 * An install's proof of GitHub ownership is the installer's own sign-in, refreshed under their
 * Connection object's gate like every other use of it.
 */
const githubInstaller =
  (connections: (userId: string) => ConnectionObject.Interface) => (userId: string) =>
    connections(userId)
      .githubLogin(userId, 60_000)
      .pipe(
        Effect.flatMap((result) =>
          result.ok
            ? Effect.succeed(result.value === null ? null : Redacted.make(result.value.access))
            : result.reason === "not-linked"
              ? Effect.succeed(null)
              : Effect.fail(
                  new InstallError({
                    platform: "github",
                    reason: "rejected",
                    detail: `github-sign-in ${result.reason}`,
                  }),
                ),
        ),
      );

/**
 * The API's services over this deployment's domains, from its configuration. Leaves the shared
 * database, the dashboard's sessions and the three object namespaces to the app.
 */
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const deployment = yield* deploymentConfig;
    const runtime = yield* runtimeConfig;
    const github = yield* githubConfig;
    const webhookSecret = yield* webhookConfig;
    const dashboard = yield* dashboardConfig;
    const key = yield* credentialKeyConfig;
    const connections = yield* ConnectionObject.Remote;

    // Every source goes through the registry: ingress, delivery, installs and the dashboard's scope lists.
    const platforms = platformsLayer(deployment, github, {
      webhookSecret,
      slack: dashboard.slack,
      githubAppSlug: dashboard.githubAppSlug,
      githubInstaller: dashboard.github === null ? null : githubInstaller(connections),
    }).pipe(Layer.provide(Credentials.layer));

    const inbox = Inbox.layer.pipe(Layer.provide(platforms));

    const domains = Layer.mergeAll(
      inbox,
      platforms,
      Workspaces.layer,
      Roles.layer,
      Environments.layer,
      Templates.layer,
      Compute.layer,
      Identities.layer,
      authentication(runtime),
    );

    return Layer.mergeAll(Drain.layer, Viewers.layer).pipe(
      Layer.provideMerge(domains),
      Layer.provideMerge(Layer.mergeAll(Sealed.layer(key), cryptoLayer)),
      // A malformed key or a platform registered twice is a deployment defect.
      Layer.orDie,
    );
  }),
);

const health = HttpRouter.add("GET", "/health", HttpServerResponse.text("ok"));

/**
 * Every HTTP surface of the API, each with its own authority: platform signatures on ingress,
 * the dev box's capability on its callback, the dashboard's session cookie on its RPC, and none
 * on the health check and the install bounce.
 */
export const routes = Layer.mergeAll(
  health,
  Ingress.routes,
  Install.routes,
  Callback.routes,
  Dashboard.routes,
);

export * as Api from "./api";

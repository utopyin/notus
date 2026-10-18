import { descriptorOf } from "@notus/compute/descriptors/index";
import { Compute } from "@notus/workspaces/compute";
import { Environments } from "@notus/workspaces/environments";
import { Templates } from "@notus/workspaces/templates";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { configurationOf, offered } from "../compute";
import { computeConfig } from "../config";
import { BuildObject } from "../objects/build";
import { DevboxRpcs, Viewer } from "./rpcs";
import type { BuildView } from "./types";
import { refusal, refuse } from "./viewers";

/**
 * A workspace's devbox configuration, the templates its admins added and the provider accounts
 * it connected. Connections are status only: who connected which provider, when.
 */
export const layer = DevboxRpcs.toLayer(
  Effect.gen(function* () {
    const enabled = yield* computeConfig;
    const environments = yield* Environments.Service;
    const templates = yield* Templates.Service;
    const accounts = yield* Compute.Service;
    const builds = yield* BuildObject.Remote;

    const registered = offered(enabled);

    /** The checks of a provider this deployment runs; any other key is refused before storage. */
    const compute = (provider: string) => {
      const configuration = configurationOf(enabled, provider);

      return configuration
        ? Effect.succeed(configuration)
        : refusal("This deployment runs no such devbox provider.");
    };

    /** The workspace's template build with one provider; null where the provider builds none. */
    const builder = (workspaceId: string, provider: string) => {
      if (!descriptorOf(provider)?.capabilities.has("template:build")) return null;
      const object = builds(`${workspaceId}:${provider}`);

      return {
        status: object.status(),
        start: (actorId: string) =>
          object.start(workspaceId, provider, actorId).pipe(
            Effect.filterOrElse(
              (view): view is BuildView => view !== null,
              () => refusal("invalid-input"),
            ),
          ),
      };
    };

    return {
      environment: ({ workspaceId, provider: requested }) =>
        Effect.gen(function* () {
          const me = yield* Viewer;
          const environment = yield* environments.view(workspaceId, me.userId);

          // The page asked for one, or shows the provider the workspace runs on, or the first.
          const provider =
            requested ?? Option.getOrUndefined(environment)?.provider ?? registered[0] ?? "";

          const configuration = yield* compute(provider);
          const own = yield* templates.list(workspaceId, me.userId);
          const mine = own.filter((template) => template.provider === provider);
          const connected = yield* accounts.list(workspaceId, me.userId);

          return {
            provider,
            providers: registered,
            environment: Option.getOrNull(environment),
            approvedImages: mine.map((template) => template.ref),
            workspaceImages: own,
            defaultImage: configuration.defaultOf({
              refs: mine.map((template) => template.ref),
              default: mine.find((template) => template.isDefault)?.ref ?? null,
            }),
            connection: connected.find((connection) => connection.provider === provider) ?? null,
            build: yield* builder(workspaceId, provider)?.status ?? Effect.succeed(null),
          };
        }).pipe(refuse),
      environmentHistory: ({ workspaceId }) =>
        refuse(Effect.flatMap(Viewer, (me) => environments.history(workspaceId, me.userId))),
      saveEnvironment: ({ workspaceId, provider, config }) =>
        Effect.gen(function* () {
          const me = yield* Viewer;
          const configuration = yield* compute(provider);
          const own = yield* templates.approved(workspaceId, provider);

          yield* configuration
            .validate(config, own)
            .pipe(Effect.catch((error) => refusal(error.message)));

          return yield* environments.save(workspaceId, me.userId, provider, config, me.now);
        }).pipe(refuse),
      /**
       * An admin vouches for a template of their own, such as an image they built from the Notus
       * base and published where the provider can pull it. Nothing here inspects it.
       */
      addImage: ({ workspaceId, provider, ref, label }) =>
        Effect.gen(function* () {
          const me = yield* Viewer;
          const configuration = yield* compute(provider);
          const value = yield* configuration
            .validateTemplate(ref)
            .pipe(Effect.catch((error) => refusal(error.message)));

          return yield* templates.add(
            workspaceId,
            me.userId,
            provider,
            value,
            label.trim(),
            me.now,
          );
        }).pipe(refuse),
      /** A stored configuration that selected it keeps it, shown as no longer approved. */
      removeImage: ({ workspaceId, provider, ref }) =>
        refuse(
          Effect.flatMap(Viewer, (me) => templates.remove(workspaceId, me.userId, provider, ref)),
        ),
      setDefaultImage: ({ workspaceId, provider, ref }) =>
        refuse(
          Effect.flatMap(Viewer, (me) =>
            templates.setDefault(workspaceId, me.userId, provider, ref),
          ),
        ),
      /** The adapter checks the credential's shape; it is sealed on write. */
      connectCompute: ({ workspaceId, provider, credential, label }) =>
        Effect.gen(function* () {
          const me = yield* Viewer;
          const configuration = yield* compute(provider);
          const normalized = yield* configuration
            .validateConnection(credential)
            .pipe(Effect.catch((error) => refusal(error.message)));

          const connected = yield* accounts.connect(
            workspaceId,
            me.userId,
            provider,
            label.trim(),
            normalized,
            me.now,
          );

          // A newly connected account holds none of the old one's snapshots, so every connect
          // builds the Notus template afresh where the provider builds one. The account is
          // connected either way; an admin can start a build that failed to.
          const build = builder(workspaceId, provider);

          if (build !== null)
            yield* build.start(me.userId).pipe(
              Effect.tapError((error) =>
                Effect.logWarning(`dashboard.build_start_failed ${error.reason}`),
              ),
              Effect.ignore,
            );

          return connected.find((connection) => connection.provider === provider) ?? null;
        }).pipe(refuse),
      /** A build already running is reported. */
      buildTemplate: ({ workspaceId, provider }) =>
        Effect.gen(function* () {
          const me = yield* Viewer;

          yield* compute(provider);
          const build = builder(workspaceId, provider);

          if (build === null)
            return yield* refusal("This provider builds no template; add one of your own.");

          yield* accounts.authorizeBuild(workspaceId, me.userId, provider);

          return yield* build.start(me.userId);
        }).pipe(refuse),
      /** Boxes already running keep running, unreachable until the account is connected again. */
      disconnectCompute: ({ workspaceId, provider }) =>
        refuse(
          Effect.flatMap(Viewer, (me) =>
            accounts.disconnect(workspaceId, me.userId, provider).pipe(Effect.asVoid),
          ),
        ),
    };
  }),
);

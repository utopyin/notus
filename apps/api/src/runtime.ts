import * as Auth from "@notus/control/runtime/auth";
import { Devbox } from "@notus/executions/devbox";
import { DevboxFailure } from "@notus/executions/errors";
import { Templates } from "@notus/compute/templates";
import { Providers } from "@notus/executions/providers";
import { Config as NamespaceConfig } from "@notus/namespace/config";
import { Instances } from "@notus/namespace/instances";
import { Namespace } from "@notus/namespace/service";
import { Images } from "@notus/workspaces/images";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { adapters } from "./compute";
import type { RuntimeConfig, namespaceConfig } from "./config";

export const authentication = (settings: RuntimeConfig | null) =>
  settings
    ? Auth.layerNoDeps.pipe(
        Layer.provide(
          Layer.succeed(Auth.Configuration, {
            audience: settings.controlUrl,
            activeKeyId: settings.activeKeyId,
            keys: settings.keys,
          }),
        ),
      )
    : Auth.disabled;

export const execution = (
  settings: RuntimeConfig | null,
  namespace: Effect.Success<typeof namespaceConfig> | null,
) => {
  if (!settings && !namespace) return Layer.merge(Auth.disabled, Devbox.disabled);
  if (!settings || !namespace)
    return Layer.merge(
      Auth.disabled,
      Layer.effect(Devbox.Service, Effect.die("Incomplete runtime configuration")),
    );
  const auth = authentication(settings);
  const authority = Layer.effect(
    Devbox.Authority,
    Effect.gen(function* () {
      const service = yield* Auth.Service;
      return Devbox.Authority.of({
        controlUrl: settings.controlUrl,
        issue: Effect.fn("Runtime.bootstrap")((bootstrap) =>
          service
            .issue(
              Auth.Capability.cases.Enrollment.make({
                audience: settings.controlUrl,
                bootstrap,
                recoveryRevision: 0,
              }),
            )
            .pipe(Effect.mapError(() => new DevboxFailure({ reason: "disabled" }))),
        ),
      });
    }),
  ).pipe(Layer.provide(auth));
  // A failed read yields no template: a launch is then refused, never an unlisted one started.
  const templates = Layer.effect(
    Templates,
    Effect.gen(function* () {
      const images = yield* Images.Service;
      return Templates.of({
        approved: (workspaceId, provider) =>
          images.approved(workspaceId, provider).pipe(
            Effect.tapError((error) =>
              Effect.logWarning(`devbox.workspace_templates_failed ${error.reason}`),
            ),
            Effect.orElseSucceed((): ReadonlyArray<string> => []),
          ),
      });
    }),
  );
  const clients = Layer.merge(Namespace.layer, Instances.layer).pipe(
    Layer.provide(
      Layer.succeed(NamespaceConfig.Service, {
        credential: namespace.credential,
        timeoutMs: namespace.timeoutMs,
      }),
    ),
  );
  // Which providers this deployment runs; a workspace naming another is refused.
  const providers = Providers.layer(adapters).pipe(Layer.provide([clients, templates]));
  const devbox = Devbox.layerNoDeps.pipe(Layer.provide([authority, providers]));
  return Layer.merge(auth, devbox);
};

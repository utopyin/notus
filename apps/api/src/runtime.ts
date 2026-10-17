import * as Auth from "@notus/control/runtime/auth";
import { Devbox } from "@notus/executions/devbox";
import { DevboxFailure } from "@notus/executions/errors";
import { Templates } from "@notus/compute/templates";
import { Providers } from "@notus/executions/providers";
import { Templates as WorkspaceTemplates } from "@notus/workspaces/templates";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { adapters } from "./compute";
import type { RuntimeConfig } from "./config";

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

/**
 * The task host's dev boxes. Provider accounts and templates are workspace data, so the only
 * deployment configuration is Notus's own authority; the caller provides the shared database's
 * template reads and sealed credentials.
 */
export const execution = (settings: RuntimeConfig | null) => {
  if (!settings) return Layer.merge(Auth.disabled, Devbox.disabled);
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
      const stored = yield* WorkspaceTemplates.Service;
      return Templates.of({
        approved: (workspaceId, provider) =>
          stored.approved(workspaceId, provider).pipe(
            Effect.tapError((error) =>
              Effect.logWarning(`devbox.workspace_templates_failed ${error.reason}`),
            ),
            Effect.orElseSucceed(() => ({ refs: [], default: null })),
          ),
      });
    }),
  );
  // Which providers this deployment runs; a workspace naming another is refused.
  const providers = Providers.layer(adapters).pipe(Layer.provide(templates));
  const devbox = Devbox.layerNoDeps.pipe(Layer.provide([authority, providers]));
  return Layer.merge(auth, devbox);
};

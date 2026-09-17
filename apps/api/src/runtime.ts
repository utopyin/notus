import * as Auth from "@notus/control/runtime/auth";
import { Devbox } from "@notus/executions/devbox";
import { DevboxFailure } from "@notus/executions/errors";
import { Config as NamespaceConfig } from "@notus/namespace/config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { RuntimeConfig, providerConfig } from "./config";

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
  provider: Effect.Success<typeof providerConfig> | null,
) => {
  if (!settings && !provider) return Layer.merge(Auth.disabled, Devbox.disabled);
  if (!settings || !provider)
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
  const native = Devbox.layer.pipe(
    Layer.provide([
      authority,
      Layer.succeed(Devbox.NamespacePolicy, {
        approvedImageRefs: provider.approvedImageRefs,
        approvedImageSource: provider.imageAudit,
      }),
      Layer.succeed(NamespaceConfig.Service, {
        credential: provider.credential,
        timeoutMs: provider.timeoutMs,
      }),
    ]),
  );
  return Layer.merge(auth, native);
};

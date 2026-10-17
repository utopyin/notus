import type { Configuration, Observation, ProviderAdapter, Resource } from "@notus/compute/adapter";
import { NAMESPACE_DESCRIPTOR } from "@notus/compute/descriptors/index";
import { ComputeError, ConfigurationError } from "@notus/compute/errors";
import { Templates } from "@notus/compute/templates";
import type { ConfigError, ControlError, InstancesError } from "@notus/namespace/errors";
import { Instances } from "@notus/namespace/instances";
import { imageRefPattern } from "@notus/namespace/restricted";
import { Namespace, validateRestricted } from "@notus/namespace/service";
import type { Resource as NativeResource } from "@notus/namespace/types";
import * as Effect from "effect/Effect";

const provider = "namespace" as const;
const descriptor = NAMESPACE_DESCRIPTOR;
type Operation = ComputeError["operation"];

const observe = (resource: NativeResource): Observation => ({
  resource: {
    id: resource.id,
    name: resource.name,
    instanceId: resource.instanceId || null,
    image: resource.image ?? null,
  },
  state: resource.state === "expired" ? "ended" : resource.state,
});
const native = (resource: Resource): NativeResource => ({
  id: resource.id,
  name: resource.name,
  ...(resource.instanceId ? { instanceId: resource.instanceId } : {}),
  state: "unknown",
  readiness: "unknown",
});

/** Status and classification only: provider messages, bodies and headers stay out of logs and errors. */
const control =
  (operation: Operation) =>
  <A, R>(effect: Effect.Effect<A, ControlError, R>): Effect.Effect<A, ComputeError, R> =>
    effect.pipe(
      Effect.tapError((error) =>
        Effect.logWarning(
          `compute.namespace.${operation}_failed ${error.operation} ${error.reason} ${error.outcome}${error.status === undefined ? "" : ` http=${error.status}`}`,
        ),
      ),
      Effect.mapError(
        (error) =>
          new ComputeError({
            provider,
            operation,
            outcome:
              error.operation === "Fetch" && error.status === 404
                ? "notFound"
                : error.outcome === "notSent" || error.outcome === "rejected"
                  ? error.outcome
                  : "unknown",
          }),
      ),
    );
const refused = (error: ConfigError) =>
  new ConfigurationError({ provider, message: error.message });

export const configuration: Configuration = {
  validate: (config, templates) =>
    validateRestricted({ config, approvedImageRefs: templates }).pipe(
      Effect.asVoid,
      Effect.mapError(refused),
    ),
  validateTemplate: (ref) => {
    const value = ref.trim();
    return value.length <= 1024 && imageRefPattern.test(value)
      ? Effect.succeed(value)
      : Effect.fail(
          new ConfigurationError({
            provider,
            message: "An image is registry/repository@sha256:digest, with no tag.",
          }),
        );
  },
};

/** Namespace behind the devbox port; the only importer of `@notus/namespace` besides the app. */
export const adapter = Effect.gen(function* () {
  const namespace = yield* Namespace.Service;
  const instances = yield* Instances.Service;
  const templates = yield* Templates;
  return {
    provider,
    descriptor,
    configuration,
    forWorkspace: (workspaceId) =>
      Effect.succeed({
        launch: Effect.fn("Compute.Namespace.launch")(function* (input) {
          const resource = yield* namespace
            .trustedLaunch({
              name: input.name,
              operationId: input.operationId,
              config: input.config,
              approvedImageRefs: yield* templates.approved(workspaceId, provider),
              bootstrap: input.bootstrap,
            })
            .pipe(
              Effect.catchTags({
                "Namespace.ConfigError": (error) => Effect.fail(refused(error)),
                "Namespace.ControlError": (error) => control("launch")(Effect.fail(error)),
              }),
            );
          return observe(resource).resource;
        }),
        recover: (name, operationId) =>
          namespace
            .recoverByName({ name, operationId })
            .pipe(control("recover"), Effect.asVoid, Effect.withSpan("Compute.Namespace.recover")),
        fetch: (resource) =>
          namespace
            .fetch({ id: resource.id })
            .pipe(
              control("fetch"),
              Effect.map(observe),
              Effect.withSpan("Compute.Namespace.fetch"),
            ),
        wake: (resource) =>
          descriptor.capabilities
            .ensure("wake:request")
            .pipe(
              Effect.andThen(namespace.activate(native(resource)).pipe(control("wake"))),
              Effect.map(observe),
              Effect.withSpan("Compute.Namespace.wake"),
            ),
        sleep: (resource) =>
          descriptor.capabilities
            .ensure("sleep:request")
            .pipe(
              Effect.andThen(namespace.stop(native(resource)).pipe(control("sleep"))),
              Effect.map(observe),
              Effect.withSpan("Compute.Namespace.sleep"),
            ),
        end: (resource) =>
          namespace
            .expire(native(resource))
            .pipe(control("end"), Effect.withSpan("Compute.Namespace.end")),
        proveReplacement: (previousInstanceId) =>
          descriptor.capabilities.ensure("replacement:proof").pipe(
            Effect.andThen(
              instances.destroyed(previousInstanceId).pipe(
                Effect.mapError(
                  (error: InstancesError) =>
                    new ComputeError({
                      provider,
                      operation: "proof",
                      outcome:
                        error.reason === "notFound"
                          ? "notFound"
                          : error.reason === "transport" || error.reason === "timeout"
                            ? "unknown"
                            : "rejected",
                    }),
                ),
              ),
            ),
            Effect.map((ended) => ({ instanceId: ended.instanceId, endedAt: ended.destroyedAt })),
            Effect.withSpan("Compute.Namespace.proveReplacement"),
          ),
      }),
  } satisfies ProviderAdapter;
});

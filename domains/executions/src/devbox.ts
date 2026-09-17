import { Instances } from "@notus/namespace/instances";
import { ConfigError, ControlError } from "@notus/namespace/errors";
import { Namespace } from "@notus/namespace/service";
import { Resource as NativeResource, type RestrictedInput } from "@notus/namespace/types";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { DevboxFailure } from "./errors";
import { Bootstrap, Claim, Enrollment, ProvisioningResult, Resource } from "./types";

export class Authority extends Context.Service<
  Authority,
  {
    readonly controlUrl: string;
    readonly issue: (binding: Bootstrap) => Effect.Effect<Redacted.Redacted<string>, DevboxFailure>;
  }
>()("@notus/executions/Devbox.Authority") {}

/** Configuration of this Namespace implementation, not a shared machine model. */
export class NamespacePolicy extends Context.Service<
  NamespacePolicy,
  Pick<RestrictedInput, "approvedImageSource"> & {
    /** Every image the workspace may launch: the deployment's, then its admins' own. */
    readonly approvedImageRefs: (
      workspaceId: string,
    ) => Effect.Effect<RestrictedInput["approvedImageRefs"]>;
  }
>()("@notus/executions/Devbox.NamespacePolicy") {}

export interface Interface {
  readonly perform: (claim: Claim) => Effect.Effect<ProvisioningResult>;
  readonly fetch: (resource: Resource) => Effect.Effect<Resource, DevboxFailure>;
  readonly verifyReplacement: (
    previous: Enrollment,
    current: Resource,
  ) => Effect.Effect<NonNullable<Enrollment["previousTermination"]>, DevboxFailure>;
}
export class Service extends Context.Service<Service, Interface>()("@notus/executions/Devbox") {}

const observe = (resource: NativeResource): Resource => ({
  id: resource.id,
  name: resource.name,
  instanceId: resource.instanceId || null,
  image: resource.image ?? null,
});
const native = (resource: Resource): NativeResource => ({
  id: resource.id,
  name: resource.name,
  ...(resource.instanceId ? { instanceId: resource.instanceId } : {}),
  state: "unknown",
  readiness: "unknown",
});
const failure = (reason: DevboxFailure["reason"]) => new DevboxFailure({ reason });

export const layerNoDeps = Layer.effect(
  Service,
  Effect.gen(function* () {
    const namespace = yield* Namespace.Service;
    const instances = yield* Instances.Service;
    const authority = yield* Authority;
    const policy = yield* NamespacePolicy;
    const fetch = Effect.fn("Devbox.fetch")(function* (stored: Resource) {
      const resource = yield* namespace
        .fetch({ id: stored.id })
        .pipe(Effect.mapError(() => failure("unavailable")));
      if (resource.name !== stored.name || resource.state === "expired")
        return yield* failure("identity");
      return observe(resource);
    });
    return Service.of({
      fetch,
      verifyReplacement: Effect.fn("Devbox.verifyReplacement")(function* (previous, current) {
        if (
          previous.resourceId !== current.id ||
          !current.instanceId ||
          previous.instanceId === current.instanceId
        )
          return yield* failure("unproven");
        const observed = yield* fetch(current);
        if (observed.instanceId !== current.instanceId) return yield* failure("identity");
        const ended = yield* instances
          .destroyed(previous.instanceId)
          .pipe(Effect.mapError(() => failure("unproven")));
        return { instanceId: ended.instanceId, endedAt: ended.destroyedAt };
      }),
      perform: Effect.fn("Devbox.perform")(
        function* (input) {
          const claim = yield* Schema.decodeEffect(Claim)(input);
          if (claim.environment.provider !== "namespace" || claim.launchVersion !== 1)
            return ProvisioningResult.cases.Rejected.make({});
          if (claim.work === "create") {
            const credential = yield* authority.issue(claim.bootstrap);
            const resource = yield* namespace.trustedLaunch({
              name: claim.providerName,
              operationId: claim.bootstrap.operationId,
              config: claim.environment.config,
              approvedImageRefs: yield* policy.approvedImageRefs(claim.environment.workspaceId),
              approvedImageSource: policy.approvedImageSource,
              bootstrap: { controlUrl: authority.controlUrl, credential },
            });
            return ProvisioningResult.cases.Assigned.make({
              operationId: claim.bootstrap.operationId,
              resource: observe(resource),
              verified: true,
            });
          }
          if (claim.work === "reconcile-create") {
            // A matching mutable description is not sufficient evidence to adopt a resource
            // after losing Create's result. Preserve the stable name for explicit intervention.
            yield* namespace.recoverByName({
              name: claim.providerName,
              operationId: claim.bootstrap.operationId,
            });
            return ProvisioningResult.cases.Unproven.make({});
          }
          if (!claim.resource) return ProvisioningResult.cases.Rejected.make({});
          const resource =
            claim.work === "activate"
              ? yield* namespace.activate(native(claim.resource))
              : yield* namespace.fetch({ id: claim.resource.id });
          if (resource.id !== claim.resource.id || resource.name !== claim.resource.name)
            return ProvisioningResult.cases.Lost.make({});
          if (resource.state === "expired")
            return ProvisioningResult.cases.ExternalExpire.make({ resourceId: resource.id });
          if (resource.state === "running" && resource.instanceId) {
            const result = { resourceId: resource.id, instanceId: resource.instanceId };
            return claim.work === "activate"
              ? ProvisioningResult.cases.Activated.make(result)
              : ProvisioningResult.cases.Running.make(result);
          }
          if (resource.state === "stopped" && claim.work !== "activate")
            return ProvisioningResult.cases.Stopped.make({
              resourceId: resource.id,
              verified: true,
            });
          return ProvisioningResult.cases.Lost.make({});
        },
        Effect.timeoutOrElse({
          duration: "20 seconds",
          orElse: () => Effect.succeed(ProvisioningResult.cases.Lost.make({})),
        }),
        (effect, input) =>
          effect.pipe(
            Effect.tapError((error) =>
              // Status and classification only: provider messages, bodies and headers stay out.
              Effect.logWarning(
                `devbox.${input.work}_failed ${error._tag}${
                  Schema.is(ControlError)(error)
                    ? ` ${error.operation} ${error.reason} ${error.outcome}${error.status === undefined ? "" : ` http=${error.status}`}`
                    : ""
                }`,
              ),
            ),
            Effect.catch((error): Effect.Effect<ProvisioningResult> => {
              if (
                Schema.is(ConfigError)(error) ||
                Schema.isSchemaError(error) ||
                Schema.is(DevboxFailure)(error)
              )
                return Effect.succeed(ProvisioningResult.cases.Rejected.make({}));
              if (Schema.is(ControlError)(error)) {
                if (error.operation === "Fetch" && error.status === 404)
                  return Effect.succeed(
                    input.work === "activate"
                      ? ProvisioningResult.cases.Rejected.make({})
                      : ProvisioningResult.cases.NotFound.make({}),
                  );
                if (error.outcome === "notSent" || error.outcome === "rejected")
                  return Effect.succeed(ProvisioningResult.cases.Rejected.make({}));
              }
              return Effect.succeed(ProvisioningResult.cases.Lost.make({}));
            }),
          ),
      ),
    });
  }),
);
export const layer = layerNoDeps.pipe(Layer.provide([Namespace.layer, Instances.layer]));
export const disabled = Layer.succeed(
  Service,
  Service.of({
    perform: () => Effect.succeed(ProvisioningResult.cases.Rejected.make({})),
    fetch: () => Effect.fail(failure("disabled")),
    verifyReplacement: () => Effect.fail(failure("disabled")),
  }),
);
export * as Devbox from "./devbox";

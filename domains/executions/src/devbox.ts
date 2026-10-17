import {
  CapabilityNotSupportedError,
  ComputeError,
  ConfigurationError,
  ProviderNotRegisteredError,
} from "@notus/compute/errors";
import type { Environment } from "@notus/workspaces/types";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { DevboxFailure } from "./errors";
import { Providers } from "./providers";
import { Bootstrap, Claim, Enrollment, ProvisioningResult, Resource } from "./types";

export class Authority extends Context.Service<
  Authority,
  {
    readonly controlUrl: string;
    readonly issue: (binding: Bootstrap) => Effect.Effect<Redacted.Redacted<string>, DevboxFailure>;
  }
>()("@notus/executions/Devbox.Authority") {}

/** Translates provider observations into provisioning reports, for whichever provider the environment names. */
export interface Interface {
  readonly perform: (claim: Claim) => Effect.Effect<ProvisioningResult>;
  readonly fetch: (
    environment: Environment | null,
    resource: Resource,
  ) => Effect.Effect<Resource, DevboxFailure>;
  readonly verifyReplacement: (
    environment: Environment | null,
    previous: Enrollment,
    current: Resource,
  ) => Effect.Effect<NonNullable<Enrollment["previousTermination"]>, DevboxFailure>;
}
export class Service extends Context.Service<Service, Interface>()("@notus/executions/Devbox") {}

const failure = (reason: DevboxFailure["reason"]) => new DevboxFailure({ reason });
/** A refusal changed nothing; anything this cannot classify must use Lost. */
const refused = (error: unknown) =>
  Schema.isSchemaError(error) ||
  Schema.is(ConfigurationError)(error) ||
  Schema.is(CapabilityNotSupportedError)(error) ||
  Schema.is(ProviderNotRegisteredError)(error) ||
  Schema.is(DevboxFailure)(error);

export const layerNoDeps = Layer.effect(
  Service,
  Effect.gen(function* () {
    const providers = yield* Providers.Service;
    const authority = yield* Authority;
    const port = (environment: Environment | null) =>
      environment
        ? providers
            .forWorkspace(environment)
            .pipe(Effect.mapError(() => failure("unsupported-provider")))
        : Effect.fail(failure("unsupported-provider"));
    const fetch = Effect.fn("Devbox.fetch")(function* (
      environment: Environment | null,
      stored: Resource,
    ) {
      const provider = yield* port(environment);
      const observed = yield* provider
        .fetch(stored)
        .pipe(Effect.mapError(() => failure("unavailable")));
      if (observed.resource.name !== stored.name || observed.state === "ended")
        return yield* failure("identity");
      return observed.resource;
    });
    return Service.of({
      fetch,
      verifyReplacement: Effect.fn("Devbox.verifyReplacement")(
        function* (environment, previous, current) {
          if (
            previous.resourceId !== current.id ||
            !current.instanceId ||
            previous.instanceId === current.instanceId
          )
            return yield* failure("unproven");
          const observed = yield* fetch(environment, current);
          if (observed.instanceId !== current.instanceId) return yield* failure("identity");
          const provider = yield* port(environment);
          const ended = yield* provider
            .proveReplacement(previous.instanceId)
            .pipe(Effect.mapError(() => failure("unproven")));
          return { instanceId: ended.instanceId, endedAt: ended.endedAt };
        },
      ),
      perform: Effect.fn("Devbox.perform")(
        function* (input) {
          const claim = yield* Schema.decodeEffect(Claim)(input);
          if (claim.launchVersion !== 1) return ProvisioningResult.cases.Rejected.make({});
          const provider = yield* providers.forWorkspace(claim.environment);
          if (claim.work === "create") {
            const credential = yield* authority.issue(claim.bootstrap);
            const resource = yield* provider.launch({
              name: claim.providerName,
              operationId: claim.bootstrap.operationId,
              config: claim.environment.config,
              bootstrap: { controlUrl: authority.controlUrl, credential },
            });
            return ProvisioningResult.cases.Assigned.make({
              operationId: claim.bootstrap.operationId,
              resource,
              verified: true,
            });
          }
          if (claim.work === "reconcile-create") {
            // A matching mutable description is not sufficient evidence to adopt a resource
            // after losing Create's result. Preserve the stable name for explicit intervention.
            yield* provider.recover(claim.providerName, claim.bootstrap.operationId);
            return ProvisioningResult.cases.Unproven.make({});
          }
          if (!claim.resource) return ProvisioningResult.cases.Rejected.make({});
          const observed =
            claim.work === "activate"
              ? yield* provider.wake(claim.resource)
              : yield* provider.fetch(claim.resource);
          const resource = observed.resource;
          if (resource.id !== claim.resource.id || resource.name !== claim.resource.name)
            return ProvisioningResult.cases.Lost.make({});
          if (observed.state === "ended")
            return ProvisioningResult.cases.ExternalExpire.make({ resourceId: resource.id });
          if (observed.state === "running" && resource.instanceId) {
            const result = { resourceId: resource.id, instanceId: resource.instanceId };
            return claim.work === "activate"
              ? ProvisioningResult.cases.Activated.make(result)
              : ProvisioningResult.cases.Running.make(result);
          }
          if (observed.state === "stopped" && claim.work !== "activate")
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
            // Classification only; the adapter logged whatever native detail is safe to keep.
            Effect.tapError((error) =>
              Effect.logWarning(
                `devbox.${input.work}_failed ${error._tag}${
                  Schema.is(ComputeError)(error) ? ` ${error.operation} ${error.outcome}` : ""
                }`,
              ),
            ),
            Effect.catch((error): Effect.Effect<ProvisioningResult> => {
              if (refused(error)) return Effect.succeed(ProvisioningResult.cases.Rejected.make({}));
              if (Schema.is(ComputeError)(error)) {
                if (error.outcome === "notFound")
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
export const disabled = Layer.succeed(
  Service,
  Service.of({
    perform: () => Effect.succeed(ProvisioningResult.cases.Rejected.make({})),
    fetch: () => Effect.fail(failure("disabled")),
    verifyReplacement: () => Effect.fail(failure("disabled")),
  }),
);
export * as Devbox from "./devbox";

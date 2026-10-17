import type {
  Configuration,
  DevboxPort,
  Observation,
  ProviderAdapter,
  Resource,
} from "@notus/compute/adapter";
import { ComputeCredentials } from "@notus/compute/credentials";
import { NAMESPACE_DESCRIPTOR } from "@notus/compute/descriptors/index";
import { ComputeError, ConfigurationError, ConnectionError } from "@notus/compute/errors";
import { Templates, type TemplateSet } from "@notus/compute/templates";
import { Config } from "@notus/namespace/config";
import type { ConfigError, ControlError, InstancesError } from "@notus/namespace/errors";
import { Instances } from "@notus/namespace/instances";
import { imageRefPattern } from "@notus/namespace/restricted";
import { Namespace, validateRestricted } from "@notus/namespace/service";
import type { Resource as NativeResource } from "@notus/namespace/types";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

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

/**
 * The workspace's own tenant. Only the token: the endpoints stay the client's defaults, so an
 * admin cannot point the deployment at another host.
 */
const Account = Schema.Struct({
  token: Schema.String.check(Schema.isPattern(/^[\x21-\x7e]{1,4096}$/)),
});
const timeoutMs = 20_000;

/** The admins' pick, or the workspace's only image. */
const defaultOf = (templates: TemplateSet) =>
  templates.default ?? (templates.refs.length === 1 ? (templates.refs[0] ?? null) : null);
/** A configuration that selects no image starts from the default, when there is one. */
const withDefault = (config: Schema.Json, templates: TemplateSet): Schema.Json => {
  const fallback = defaultOf(templates);
  return fallback !== null &&
    config !== null &&
    typeof config === "object" &&
    !Array.isArray(config) &&
    !("imageRef" in config && config.imageRef)
    ? Object.fromEntries([...Object.entries(config), ["imageRef", fallback]])
    : config;
};

export const configuration: Configuration = {
  validate: (config, templates) =>
    validateRestricted({
      config: withDefault(config, templates),
      approvedImageRefs: templates.refs,
    }).pipe(Effect.asVoid, Effect.mapError(refused)),
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
  validateConnection: (input) =>
    Schema.decodeUnknownEffect(Account)(input, { onExcessProperty: "error" }).pipe(
      Effect.map((account): Schema.Json => ({ token: account.token })),
      Effect.mapError(
        () =>
          new ConfigurationError({
            provider,
            message: "A Namespace token is printable text with no spaces.",
          }),
      ),
    ),
  defaultOf,
};

type Clients = Namespace.Service | Instances.Service;
/** One workspace's Namespace clients, provided to a single call. */
type Run = <A, E>(effect: Effect.Effect<A, E, Clients>) => Effect.Effect<A, E>;

const port = (workspaceId: string, templates: Templates["Service"], run: Run): DevboxPort => ({
  launch: Effect.fn("Compute.Namespace.launch")(function* (input) {
    const set = yield* templates.approved(workspaceId, provider);
    const resource = yield* run(
      Namespace.Service.pipe(
        Effect.flatMap((namespace) =>
          namespace.trustedLaunch({
            name: input.name,
            operationId: input.operationId,
            config: withDefault(input.config, set),
            approvedImageRefs: set.refs,
            bootstrap: input.bootstrap,
          }),
        ),
      ),
    ).pipe(
      Effect.catchTags({
        "Namespace.ConfigError": (error) => Effect.fail(refused(error)),
        "Namespace.ControlError": (error) => control("launch")(Effect.fail(error)),
      }),
    );
    return observe(resource).resource;
  }),
  recover: (name, operationId) =>
    run(Namespace.Service.pipe(Effect.flatMap((n) => n.recoverByName({ name, operationId })))).pipe(
      control("recover"),
      Effect.asVoid,
      Effect.withSpan("Compute.Namespace.recover"),
    ),
  fetch: (resource) =>
    run(Namespace.Service.pipe(Effect.flatMap((n) => n.fetch({ id: resource.id })))).pipe(
      control("fetch"),
      Effect.map(observe),
      Effect.withSpan("Compute.Namespace.fetch"),
    ),
  wake: (resource) =>
    descriptor.capabilities
      .ensure("wake:request")
      .pipe(
        Effect.andThen(
          run(Namespace.Service.pipe(Effect.flatMap((n) => n.activate(native(resource))))).pipe(
            control("wake"),
          ),
        ),
        Effect.map(observe),
        Effect.withSpan("Compute.Namespace.wake"),
      ),
  sleep: (resource) =>
    descriptor.capabilities
      .ensure("sleep:request")
      .pipe(
        Effect.andThen(
          run(Namespace.Service.pipe(Effect.flatMap((n) => n.stop(native(resource))))).pipe(
            control("sleep"),
          ),
        ),
        Effect.map(observe),
        Effect.withSpan("Compute.Namespace.sleep"),
      ),
  end: (resource) =>
    run(Namespace.Service.pipe(Effect.flatMap((n) => n.expire(native(resource))))).pipe(
      control("end"),
      Effect.withSpan("Compute.Namespace.end"),
    ),
  proveReplacement: (previousInstanceId) =>
    descriptor.capabilities.ensure("replacement:proof").pipe(
      Effect.andThen(
        run(Instances.Service.pipe(Effect.flatMap((i) => i.destroyed(previousInstanceId)))).pipe(
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
});

/**
 * Namespace behind the devbox port, with clients built per workspace from its own sealed token.
 * The only importer of `@notus/namespace` besides the dashboard's form.
 */
export const adapter = Effect.gen(function* () {
  const credentials = yield* ComputeCredentials;
  const templates = yield* Templates;
  return {
    provider,
    descriptor,
    configuration,
    forWorkspace: Effect.fn("Compute.Namespace.forWorkspace")(function* (workspaceId: string) {
      const stored = yield* credentials.get(workspaceId, provider);
      if (Option.isNone(stored)) return yield* new ConnectionError({ provider, reason: "missing" });
      const account = yield* Schema.decodeUnknownEffect(Account)(stored.value).pipe(
        Effect.mapError(() => new ConnectionError({ provider, reason: "invalid" })),
      );
      // The token passed the client's own credential rule above and the endpoints are its
      // defaults, so building the clients cannot refuse them.
      const clients = Layer.merge(Namespace.layer, Instances.layer).pipe(
        Layer.provide(Config.layer({ credential: Redacted.make(account.token), timeoutMs })),
        Layer.orDie,
      );
      return port(workspaceId, templates, (effect) => effect.pipe(Effect.provide(clients)));
    }),
  } satisfies ProviderAdapter;
});

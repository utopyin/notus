import type { Configuration, DevboxPort, ProviderAdapter } from "@notus/compute/adapter";
import type { ProviderDescriptor } from "@notus/compute/descriptor";
import {
  DuplicateProviderRegistrationError,
  ProviderNotRegisteredError,
} from "@notus/compute/errors";
import type { Provider } from "@notus/compute/provider";
import type { Environment } from "@notus/workspaces/types";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export interface ProviderScope {
  readonly descriptor: ProviderDescriptor;
  readonly configuration: Configuration;
}
export interface WorkspacePort extends DevboxPort {
  readonly descriptor: ProviderDescriptor;
}

/** Every method hands back a scope or a port; the raw adapter never escapes. */
export interface Interface {
  readonly forProvider: (
    provider: string,
  ) => Effect.Effect<ProviderScope, ProviderNotRegisteredError>;
  /** The port of the provider the workspace's environment names. */
  readonly forWorkspace: (
    environment: Pick<Environment, "workspaceId" | "provider">,
  ) => Effect.Effect<WorkspacePort, ProviderNotRegisteredError>;
}
export class Service extends Context.Service<Service, Interface>()("@notus/executions/Providers") {}

type AdapterSet = ReadonlyMap<string, ProviderAdapter>;
/** Reachable only through `layerAdapters`, never yielded directly. */
class ProviderAdapters extends Context.Service<ProviderAdapters, AdapterSet>()(
  "@notus/executions/ProviderAdapters",
) {}

export const layerNoDeps = Layer.effect(
  Service,
  Effect.gen(function* () {
    const adapters = yield* ProviderAdapters;
    const adapterFor = (provider: string) => {
      const adapter = adapters.get(provider);
      return adapter === undefined
        ? Effect.fail(new ProviderNotRegisteredError({ provider }))
        : Effect.succeed(adapter);
    };
    return Service.of({
      forProvider: Effect.fn("Providers.forProvider")(function* (provider: string) {
        const adapter = yield* adapterFor(provider);
        return { descriptor: adapter.descriptor, configuration: adapter.configuration };
      }),
      forWorkspace: Effect.fn("Providers.forWorkspace")(function* (environment) {
        const adapter = yield* adapterFor(environment.provider);
        const port = yield* adapter.forWorkspace(environment.workspaceId);
        return { ...port, descriptor: adapter.descriptor };
      }),
    });
  }),
);

/**
 * The host's adapter set. Which providers exist is host authority: a host that wants none writes
 * `layerAdapters(Effect.succeed([]))` and says so.
 */
export const layerAdapters = <E, R>(
  adapters: Effect.Effect<ReadonlyArray<ProviderAdapter>, E, R>,
): Layer.Layer<ProviderAdapters, E | DuplicateProviderRegistrationError, R> =>
  Layer.effect(
    ProviderAdapters,
    Effect.gen(function* () {
      const built = yield* adapters;
      const registered = new Map<Provider, ProviderAdapter>();
      for (const adapter of built) {
        if (registered.has(adapter.provider))
          return yield* new DuplicateProviderRegistrationError({ provider: adapter.provider });
        registered.set(adapter.provider, adapter);
      }
      return registered;
    }),
  );

/** The registry over one host's adapter set, usually `Effect.all([namespace])`. */
export const layer = <E, R>(adapters: Effect.Effect<ReadonlyArray<ProviderAdapter>, E, R>) =>
  layerNoDeps.pipe(Layer.provide(layerAdapters(adapters)));

export * as Providers from "./providers";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { InstallationSurfaces, PlatformAdapter } from "./adapter";
import type { PlatformDescriptor } from "./descriptor";
import {
  DuplicatePlatformRegistrationError,
  type InstallationNotFound,
  PlatformNotRegisteredError,
} from "./errors";
import type { InstallationRef } from "./ids";
import type { PlatformIngress } from "./ingress";
import type { Platform } from "./platform";

export interface PlatformScope {
  readonly descriptor: PlatformDescriptor;
  readonly ingress: PlatformIngress;
}
export interface InstallationPort extends InstallationSurfaces {
  readonly descriptor: PlatformDescriptor;
}

/** Every method hands back a scope or a port; the raw adapter never escapes. */
export interface Interface {
  readonly forPlatform: (
    platform: Platform,
  ) => Effect.Effect<PlatformScope, PlatformNotRegisteredError>;
  readonly forInstallation: (
    ref: InstallationRef,
  ) => Effect.Effect<InstallationPort, PlatformNotRegisteredError | InstallationNotFound>;
}
export class Service extends Context.Service<Service, Interface>()("@notus/sources/Platforms") {}

type AdapterSet = ReadonlyMap<Platform, PlatformAdapter>;
/** Reachable only through `layerAdapters`, never yielded directly. */
class PlatformAdapters extends Context.Service<PlatformAdapters, AdapterSet>()(
  "@notus/sources/PlatformAdapters",
) {}

export const layerNoDeps = Layer.effect(
  Service,
  Effect.gen(function* () {
    const adapters = yield* PlatformAdapters;
    const adapterFor = (platform: Platform) => {
      const adapter = adapters.get(platform);
      return adapter === undefined
        ? Effect.fail(new PlatformNotRegisteredError({ platform }))
        : Effect.succeed(adapter);
    };
    const forPlatform = Effect.fn("Platforms.forPlatform")(function* (platform: Platform) {
      const adapter = yield* adapterFor(platform);
      return { descriptor: adapter.descriptor, ingress: adapter.ingress } satisfies PlatformScope;
    });
    const forInstallation = Effect.fn("Platforms.forInstallation")(function* (
      ref: InstallationRef,
    ) {
      const adapter = yield* adapterFor(ref.platform);
      const surfaces = yield* adapter.forInstallation(ref);
      return { ...surfaces, descriptor: adapter.descriptor } satisfies InstallationPort;
    });
    return Service.of({ forPlatform, forInstallation });
  }),
);

/**
 * The host's adapter set. Which platforms exist is host authority: a host that wants none writes
 * `layerAdapters(Effect.succeed([]))` and says so.
 */
export const layerAdapters = <E, R>(
  adapters: Effect.Effect<ReadonlyArray<PlatformAdapter>, E, R>,
): Layer.Layer<PlatformAdapters, E | DuplicatePlatformRegistrationError, R> =>
  Layer.effect(
    PlatformAdapters,
    Effect.gen(function* () {
      const built = yield* adapters;
      const registered = new Map<Platform, PlatformAdapter>();
      for (const adapter of built) {
        if (registered.has(adapter.platform))
          return yield* new DuplicatePlatformRegistrationError({ platform: adapter.platform });
        registered.set(adapter.platform, adapter);
      }
      return registered;
    }),
  );

/** The registry over one host's adapter set, usually `Effect.all([slack, github])`. */
export const layer = <E, R>(adapters: Effect.Effect<ReadonlyArray<PlatformAdapter>, E, R>) =>
  layerNoDeps.pipe(Layer.provide(layerAdapters(adapters)));

export * as Platforms from "./registry";

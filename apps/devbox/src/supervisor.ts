import { Client } from "@notus/herdr/client";
import { protocol, version } from "@notus/herdr/types";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";
import * as FileSystem from "effect/FileSystem";
import type * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import type * as Scope from "effect/Scope";
import type { Failure as HerdrFailure } from "@notus/herdr/errors";
import * as Commands from "./commands";
import { acquireDirectory, assertPlatform, launch, validateDirectories } from "./host";
import { Failure, Settings } from "./settings";
import { Callback } from "./callback";

export interface Interface {
  readonly check: Effect.Effect<void, Failure | HerdrFailure>;
  readonly start: Effect.Effect<
    never,
    Failure | HerdrFailure,
    Scope.Scope | ChildProcessSpawner.ChildProcessSpawner
  >;
}
export class Service extends Context.Service<Service, Interface>()("@notus/devbox/Supervisor") {}

export const layerNoDeps = Layer.effect(
  Service,
  Effect.gen(function* () {
    const client = yield* Client.Service;
    const callback = yield* Callback.Service;
    const settings = yield* Settings.Service;
    const stdio = yield* Stdio.Stdio;
    const fs = yield* FileSystem.FileSystem;
    // snapshot performs a new native ping first. Neither operation executes agents.
    const observe = Effect.asVoid(client.snapshot);
    const report = Schema.encodeEffect(
      Schema.fromJsonString(
        Schema.Struct({
          status: Schema.Literal("runtime-ready"),
          taskAuthorized: Schema.Literal(false),
          herdrVersion: Schema.String,
          protocol: Schema.Int,
        }),
      ),
    )({
      status: "runtime-ready",
      taskAuthorized: false,
      herdrVersion: version,
      protocol,
    }).pipe(
      Effect.flatMap((line) => Stream.make(line + "\n").pipe(Stream.run(stdio.stdout()))),
      Effect.orDie,
    );
    const check = Effect.gen(function* () {
      yield* assertPlatform;
      yield* validateDirectories(settings);
      // A local CLI probe cannot assert durable Control acknowledgment.
      if (callback.bound) return yield* new Failure({ reason: "binding" });
      yield* observe;
      yield* report;
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.withSpan("Devbox.Supervisor.check"),
    );
    const start = Effect.gen(function* () {
      yield* assertPlatform;
      yield* acquireDirectory(settings);
      yield* callback.enroll;
      const child = yield* launch(settings.directory, settings.socketPath);
      const unexpectedExit = child.exitCode.pipe(
        Effect.ignore,
        Effect.andThen(Effect.fail(new Failure({ reason: "child-exited" }))),
      );
      const ready = observe.pipe(
        Effect.retry({
          schedule: Schedule.spaced("100 millis"),
          while: (failure) =>
            failure.reason === "connect" ||
            failure.reason === "eof" ||
            failure.reason === "timeout",
        }),
        Effect.timeoutOrElse({
          duration: "15 seconds",
          orElse: () => Effect.fail(new Failure({ reason: "startup" })),
        }),
      );
      return yield* Effect.gen(function* () {
        yield* callback.ready(ready);
        yield* report;
        // Serve operator commands for as long as Control accepts this runtime.
        return yield* callback
          .commands(Commands.run)
          .pipe(Effect.provideService(Settings.Service, settings));
      }).pipe(Effect.raceFirst(unexpectedExit));
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.withSpan("Devbox.Supervisor.start"),
    );
    return Service.of({ check, start });
  }),
);
export const layer = layerNoDeps;
export * as Supervisor from "./supervisor";

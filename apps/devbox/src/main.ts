import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import { BunSocket } from "@notus/herdr/bun";
import { Client } from "@notus/herdr/client";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";
import { Failure, Settings } from "./settings";
import { Supervisor } from "./supervisor";
import { Callback } from "./callback";

const client = Layer.unwrap(
  Effect.gen(function* () {
    const settings = yield* Settings.Service;
    return Client.layer({ socketPath: settings.socketPath }).pipe(Layer.provide(BunSocket.layer));
  }),
);
const runtime = Supervisor.layer.pipe(
  Layer.provide(client),
  Layer.provide(Callback.layer),
  Layer.provide(Settings.layer),
);

const main = Effect.gen(function* () {
  const supervisor = yield* Supervisor.Service;
  const [command, ...extra] = process.argv.slice(2);
  if (extra.length !== 0) return yield* new Failure({ reason: "usage" });
  switch (command) {
    case "start":
      return yield* supervisor.start;
    case "check":
    case "doctor":
      return yield* supervisor.check;
    default:
      return yield* new Failure({ reason: "usage" });
  }
}).pipe(
  Effect.scoped,
  Effect.provide(runtime),
  Effect.tapCause((cause) =>
    Cause.hasInterrupts(cause)
      ? Effect.void
      : Effect.gen(function* () {
          const stdio = yield* Stdio.Stdio;
          // Do not print wire frames, environment, paths, daemon output or defect stacks.
          const line = yield* Schema.encodeEffect(
            Schema.fromJsonString(
              Schema.Struct({
                status: Schema.Literal("failed"),
                taskAuthorized: Schema.Literal(false),
              }),
            ),
          )({ status: "failed", taskAuthorized: false });
          yield* Stream.make(line + "\n").pipe(Stream.run(stdio.stderr()));
        }).pipe(Effect.orDie),
  ),
);

// BunRuntime owns SIGINT/SIGTERM. Route SIGHUP to the same main fiber and
// keep the listener until child reaping and directory release have finished.
const hangup = Effect.withFiber((fiber) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const interrupt = () => fiber.interruptUnsafe(fiber.id);
      process.on("SIGHUP", interrupt);
      return interrupt;
    }),
    (interrupt) => Effect.sync(() => process.removeListener("SIGHUP", interrupt)),
  ),
);

BunRuntime.runMain(
  hangup.pipe(Effect.andThen(main), Effect.scoped, Effect.provide(BunServices.layer)),
  {
    disableErrorReporting: true,
  },
);

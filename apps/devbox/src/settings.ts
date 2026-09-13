import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

export class Failure extends Schema.TaggedError<Failure>()("Devbox.Failure", {
  reason: Schema.Literals([
    "platform",
    "binding",
    "state",
    "locked",
    "spawn",
    "child-exited",
    "startup",
    "usage",
  ]),
}) {}

export class Service extends Context.Service<
  Service,
  {
    readonly stateRoot: string;
    readonly kernelBootId: string;
    readonly directory: string;
    readonly socketPath: string;
  }
>()("@notus/devbox/Settings") {}

const KernelBootId = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
);

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const stateRoot = yield* Config.string("NOTUS_STATE_DIR").pipe(
      Config.withDefault("/home/devbox/.local/state/notus"),
    );
    // Read once per runtime graph from Linux, never from launch configuration.
    // A boot ID selects local state; it is not proof that a copied-volume VM is dead.
    const kernelBootId = yield* fs.readFileString("/proc/sys/kernel/random/boot_id").pipe(
      Effect.flatMap((value) => Schema.decodeEffect(KernelBootId)(value.trimEnd())),
      Effect.mapError(() => new Failure({ reason: "state" })),
    );
    const directory = `${stateRoot}/boots/${kernelBootId}`;
    const socketPath = `${directory}/owner/herdr.sock`;
    // Linux sockaddr_un has 108 bytes, including the NUL. Bound the full UTF-8 path.
    if (
      !stateRoot.startsWith("/home/devbox/") ||
      stateRoot
        .slice(1)
        .split("/")
        .some((part) => part === "" || part === ".." || part === ".") ||
      new TextEncoder().encode(socketPath).length > 107 ||
      stateRoot.includes("\0")
    ) {
      return yield* new Failure({ reason: "state" });
    }
    return Service.of({ stateRoot, kernelBootId, directory, socketPath });
  }),
);

export * as Settings from "./settings";

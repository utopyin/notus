import type {
  Build,
  BuildStep,
  Configuration,
  DevboxPort,
  Observation,
  ProviderAdapter,
  Resource,
  State,
} from "@notus/compute/adapter";
import { ComputeCredentials } from "@notus/compute/credentials";
import { BOAT_DESCRIPTOR } from "@notus/compute/descriptors/index";
import { ComputeError, ConfigurationError, ConnectionError } from "@notus/compute/errors";
import { Recipe, type RecipeFile } from "@notus/compute/recipe";
import { Templates, type TemplateSet } from "@notus/compute/templates";
import { Config } from "@notus/boat/config";
import type { BoatError } from "@notus/boat/errors";
import { Boat } from "@notus/boat/service";
import { MachineType, type Sandbox, SandboxId, TemplateName } from "@notus/boat/types";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

const provider = "boat" as const;
const descriptor = BOAT_DESCRIPTOR;

type Operation = ComputeError["operation"];

/**
 * The workspace's native configuration: the named snapshot a box starts from (or none, for the
 * default), its size, and Boat's auto-stop deadline in seconds (null for none, absent for Boat's
 * own hour). The deadline stops a box even mid-command.
 */
const Native = Schema.Struct({
  template: Schema.optionalKey(TemplateName),
  type: Schema.optionalKey(MachineType),
  autoStopSeconds: Schema.optionalKey(
    Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 60, maximum: 2_592_000 }))),
  ),
});

type Native = typeof Native.Type;

/** The workspace's own account: its API key alone; the endpoint is the client's. */
const Account = Schema.Struct({
  apiKey: Schema.String.check(Schema.isPattern(/^(?:boat|box)_[\x21-\x7e]{1,4096}$/)),
});

const timeoutMs = 15_000;
/** Boat's auto-stop when the configuration sets none. */
const boatDefaultStopSeconds = 3600;

/** Linux's boot id, read through Boat's own API: the machine currently backing the sandbox. */
const BootId = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
);
/** The supervisor's environment file is parsed by systemd; nothing in it may need quoting. */
const Plain = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._~:/?#@!&()*+,;=%-]{1,4096}$/));

/**
 * Runs once after create, as the sandbox user with passwordless sudo. Per-sandbox `env` does not
 * reach systemd units, so the bootstrap goes to a root-only environment file the template's
 * `notus-devbox.service` reads; the unit then starts again by itself after every resume.
 * A snapshot saved from a box that already ran the supervisor carries its journal, which would win
 * over this launch's bootstrap; a created sandbox is always a new box, so its state starts empty.
 */
const setupScript = `set -eu
sudo systemctl stop notus-devbox.service || true
sudo rm -rf /home/devbox/.local/state/notus
sudo install -d -m 0700 -o 1001 -g 1001 /home/devbox/.local/state/notus
sudo install -d -m 0755 -o root -g root /etc/notus
printf 'NOTUS_CONTROL_URL=%s\\nNOTUS_BOOTSTRAP_TOKEN=%s\\n' "$NOTUS_CONTROL_URL" "$NOTUS_BOOTSTRAP_TOKEN" \\
  | sudo sh -c 'umask 077; cat > /etc/notus/bootstrap.env'
sudo systemctl restart notus-devbox.service
`;

/** The snapshot a build saves; a rebuild replaces it once the new one is ready. */
const builtName = "notus-base";
/** Where the recipe's files go on the build machine; Boat writes only under the user's home. */
const recipeDir = "/home/user/notus";
/** A build machine Notus loses track of stops by itself. */
const buildStopSeconds = 1800;
/** The recipe took about 20 s in the live check; apt and the downloads can take longer. */
const recipeSeconds = 540;
/**
 * Runs the recipe as root with its output kept off the response, then removes the recipe's own
 * files so the snapshot carries only what it installed. A retried step whose first run is still
 * going waits for it on the lock instead of racing it for apt.
 */
const installCommand = `sudo flock /tmp/notus-recipe.lock bash ${recipeDir}/recipe.sh >/tmp/notus-recipe.log 2>&1 && rm -rf ${recipeDir}`;

/** Where a build stands between steps; the host stores it unread. */
const Progress = Schema.Struct({
  step: Schema.Literals(["boot", "install", "save", "saving"]),
  sandboxId: SandboxId,
});

type Progress = typeof Progress.Type;

/** The admins' pick, or the workspace's only snapshot. */
const defaultOf = (templates: TemplateSet) =>
  templates.default ?? (templates.refs.length === 1 ? (templates.refs[0] ?? null) : null);

const refuse = (message: string) => new ConfigurationError({ provider, message });

const decodeNative = (config: Schema.Json) =>
  Schema.decodeUnknownEffect(Native)(config, { onExcessProperty: "error" }).pipe(
    Effect.mapError(() =>
      refuse("A Boat configuration names a snapshot, a size and an auto-stop time, nothing else."),
    ),
  );

/** The snapshot a launch starts from: the configured one, else the default; always a listed one. */
const templateOf = (native: Native, templates: TemplateSet) => {
  const template = native.template ?? defaultOf(templates);
  if (template === null) return Effect.fail(refuse("Choose one of the workspace's snapshots."));

  if (!templates.refs.includes(template))
    return Effect.fail(refuse("Configuration must select one of the workspace's snapshots."));

  return Effect.succeed(template);
};

export const configuration: Configuration = {
  validate: (config, templates) =>
    decodeNative(config).pipe(
      Effect.flatMap((native) => templateOf(native, templates)),
      Effect.asVoid,
    ),
  validateTemplate: (ref) => {
    const value = ref.trim();

    return Schema.is(TemplateName)(value)
      ? Effect.succeed(value)
      : Effect.fail(
          refuse("A snapshot is the name it was saved under, or a share code starting bsh_."),
        );
  },
  validateConnection: (input) =>
    Schema.decodeUnknownEffect(Account)(input, { onExcessProperty: "error" }).pipe(
      Effect.map((account): Schema.Json => ({ apiKey: account.apiKey })),
      Effect.mapError(() => refuse("A Boat API key starts with boat_.")),
    ),
  defaultOf,
};

const stateOf = (state: Sandbox["state"]): State => {
  switch (state) {
    case "ready":
    case "idle":
    case "running":
      return "running";
    case "archived":
      return "stopped";
    case "cancelled":
      return "ended";
    default:
      return "unknown";
  }
};

const live = (state: Sandbox["state"]) => stateOf(state) === "running";

/** Status and classification only: Boat's messages and bodies never reach logs or errors. */
const control =
  (operation: Operation) =>
  <A, R>(effect: Effect.Effect<A, BoatError, R>): Effect.Effect<A, ComputeError, R> =>
    effect.pipe(
      Effect.tapError((error) =>
        Effect.logWarning(
          `compute.boat.${operation}_failed ${error.operation} ${error.reason} ${error.outcome}${
            error.status === undefined ? "" : ` http=${error.status}`
          }${error.code === undefined ? "" : ` code=${error.code}`}`,
        ),
      ),
      Effect.mapError(
        (error) =>
          new ComputeError({
            provider,
            operation,
            outcome: error.outcome,
          }),
      ),
    );

type Run = <A, E>(effect: Effect.Effect<A, E, Boat.Service>) => Effect.Effect<A, E>;

const port = (
  workspaceId: string,
  templates: Templates["Service"],
  files: ReadonlyArray<RecipeFile>,
  run: Run,
): DevboxPort => {
  const boat = <A>(f: (client: Boat.Interface) => Effect.Effect<A, BoatError>) =>
    run(Boat.Service.pipe(Effect.flatMap(f)));

  /** The machine's boot id, or null while none runs or it does not answer yet. */
  const bootId = (id: string) =>
    boat((client) => client.command(id, "/bin/cat /proc/sys/kernel/random/boot_id", 5)).pipe(
      Effect.map((result) => {
        const value = result.stdout.trim();
        return result.exitCode === 0 && Schema.is(BootId)(value) ? value : null;
      }),
      Effect.orElseSucceed(() => null),
    );

  /** The stored name is Notus's own; the sandbox id alone is the identity. */
  const observe = (stored: Pick<Resource, "name" | "image">, sandbox: Sandbox) =>
    Effect.gen(function* () {
      const state = stateOf(sandbox.state);
      const instanceId = state === "running" ? yield* bootId(sandbox.id) : null;

      const resource: Resource = {
        id: sandbox.id,
        name: stored.name,
        instanceId,
        image: stored.image,
      };

      // A live sandbox counts as running only once its machine answers.
      return {
        resource,
        state: state === "running" && instanceId === null ? "unknown" : state,
      } satisfies Observation;
    });

  /** Polls until the sandbox leaves its transitional states, within the Devbox call's bound. */
  const settle = (id: string, done: (state: Sandbox["state"]) => boolean, operation: Operation) =>
    Effect.gen(function* () {
      // Resume reached ready in about a second in the probe; eight leaves room for the boot id.
      for (let attempt = 0; attempt < 8; attempt++) {
        const sandbox = yield* boat((client) => client.get(id)).pipe(control(operation));
        if (done(sandbox.state)) return sandbox;
        yield* Effect.sleep("1 second");
      }

      return yield* boat((client) => client.get(id)).pipe(control(operation));
    });

  /** A plain Boat machine, keyed by the build, with nothing of the account's on it. */
  const buildMachine = (input: Build) => ({
    idempotencyKey: input.operationId,
    type: "small" as const,
    ttlSeconds: buildStopSeconds,
  });

  /** The host stores progress unread, so anything else is a defect of this adapter. */
  const progressOf = (input: Build) =>
    input.progress === null
      ? Effect.succeed(null)
      : Schema.decodeUnknownEffect(Progress)(input.progress).pipe(Effect.orDie);

  const next = (progress: Progress, afterMs: number): BuildStep => ({
    _tag: "Continue",
    progress,
    afterMs,
  });

  const removeBuildMachine = (sandboxId: string) =>
    boat((client) => client.remove(sandboxId)).pipe(
      Effect.catchIf(
        (error) => error.outcome === "notFound",
        () => Effect.void,
      ),
      control("build"),
    );

  /** Removes the build machine, then reports why the build cannot go on. */
  const abandon = (sandboxId: string, reason: string) =>
    removeBuildMachine(sandboxId).pipe(Effect.as<BuildStep>({ _tag: "Failed", reason }));

  const buildStep = (input: Build) =>
    Effect.gen(function* () {
      const progress = yield* progressOf(input);

      if (progress === null) {
        const sandbox = yield* boat((client) => client.create(buildMachine(input))).pipe(
          control("build"),
        );

        return next({ step: "boot", sandboxId: sandbox.id }, 1000);
      }

      const { sandboxId } = progress;

      switch (progress.step) {
        case "boot": {
          const sandbox = yield* boat((client) => client.get(sandboxId)).pipe(control("build"));

          if (live(sandbox.state)) return next({ step: "install", sandboxId }, 0);

          if (sandbox.state === "error" || sandbox.state === "cancelled")
            return yield* abandon(sandboxId, "Boat could not start a machine to build on.");

          return next(progress, 2000);
        }
        case "install": {
          if (files.find((file) => file.name === "recipe.sh") === undefined)
            return yield* abandon(sandboxId, "This deployment ships no Boat recipe.");

          for (const file of files)
            yield* boat((client) =>
              client.writeFile(sandboxId, `${recipeDir}/${file.name}`, file.content),
            ).pipe(control("build"));

          const result = yield* boat((client) =>
            client.command(sandboxId, installCommand, recipeSeconds),
          ).pipe(control("build"));

          if (result.exitCode !== 0)
            return yield* abandon(sandboxId, "The Notus recipe failed on the build machine.");

          return next({ step: "save", sandboxId }, 0);
        }
        case "save": {
          yield* boat((client) => client.saveSnapshot(sandboxId, builtName)).pipe(control("build"));
          return next({ step: "saving", sandboxId }, 5000);
        }
        case "saving": {
          const snapshot = yield* boat((client) => client.getSnapshot(builtName)).pipe(
            control("build"),
          );

          if (snapshot.status === "saving") return next(progress, 5000);

          if (snapshot.status === "failed")
            return yield* abandon(sandboxId, "Boat could not save the snapshot.");

          yield* removeBuildMachine(sandboxId);

          return { _tag: "Ready", ref: builtName } satisfies BuildStep;
        }
      }
    });

  return {
    launch: Effect.fn("Compute.Boat.launch")(function* (input) {
      const set = yield* templates.approved(workspaceId, provider);
      const native = yield* decodeNative(input.config);
      const template = yield* templateOf(native, set);

      const controlUrl = yield* Schema.decodeEffect(Plain)(input.bootstrap.controlUrl).pipe(
        Effect.mapError(() => refuse("The control URL cannot be written for the box.")),
      );
      const token = yield* Schema.decodeEffect(Plain)(
        Redacted.value(input.bootstrap.credential),
      ).pipe(
        Effect.mapError(() => refuse("The bootstrap credential cannot be written for the box.")),
      );

      const sandbox = yield* boat((client) =>
        client.create({
          // One operation, one sandbox: a lost answer retried with the same body returns it.
          idempotencyKey: input.operationId,
          from: template,
          ...(native.type === undefined ? {} : { type: native.type }),
          ...(native.autoStopSeconds === undefined ? {} : { ttlSeconds: native.autoStopSeconds }),
          env: { NOTUS_CONTROL_URL: controlUrl, NOTUS_BOOTSTRAP_TOKEN: token },
          setupScript,
        }),
      ).pipe(control("launch"));

      return { id: sandbox.id, name: input.name, instanceId: null, image: { template } };
    }),
    // Boat takes no name at create, so a lost result leaves no handle beyond the idempotency key,
    // whose body held a bootstrap credential since replaced. Recovery stays explicit.
    recover: () => Effect.void,
    fetch: (resource) =>
      boat((client) => client.get(resource.id)).pipe(
        control("fetch"),
        Effect.flatMap((sandbox) => observe(resource, sandbox)),
        Effect.withSpan("Compute.Boat.fetch"),
      ),
    wake: (resource) =>
      descriptor.capabilities.ensure("wake:request").pipe(
        Effect.andThen(
          Effect.gen(function* () {
            let sandbox = yield* settle(resource.id, (state) => state !== "archiving", "wake");

            if (sandbox.state === "archived")
              sandbox = yield* boat((client) => client.resume(resource.id)).pipe(
                // A stopped box whose disk Boat deleted after 14 days is gone for good.
                Effect.catchIf(
                  (error) => error.code === "snapshot_data_expired",
                  () =>
                    Effect.succeed({
                      id: sandbox.id,
                      name: sandbox.name,
                      state: "cancelled" as const,
                    }),
                ),
                control("wake"),
              );

            if (sandbox.state === "cancelled" || sandbox.state === "error")
              return yield* observe(resource, sandbox);

            sandbox = yield* settle(
              resource.id,
              (state) => live(state) || state === "error",
              "wake",
            );

            return yield* observe(resource, sandbox);
          }),
        ),
        Effect.withSpan("Compute.Boat.wake"),
      ),
    sleep: (resource) =>
      descriptor.capabilities.ensure("sleep:request").pipe(
        Effect.andThen(
          boat((client) => client.stop(resource.id)).pipe(
            control("sleep"),
            Effect.andThen(
              settle(resource.id, (state) => state === "archived" || state === "error", "sleep"),
            ),
            Effect.flatMap((sandbox) => observe(resource, sandbox)),
          ),
        ),
        Effect.withSpan("Compute.Boat.sleep"),
      ),
    end: (resource) =>
      boat((client) => client.remove(resource.id)).pipe(
        control("end"),
        Effect.withSpan("Compute.Boat.end"),
      ),
    // Boat's deadline counts from the last create, resume or change, and only ever runs down, so
    // the configured auto-stop bounds what is left of it. Holding for at least that long never
    // shortens it; handing back restarts the configured idle window from the end of the work.
    hold: (resource, config, seconds) =>
      descriptor.capabilities.ensure("activity:lease").pipe(
        Effect.andThen(decodeNative(config)),
        Effect.flatMap((native) => {
          const stop =
            native.autoStopSeconds === undefined ? boatDefaultStopSeconds : native.autoStopSeconds;
          // Without auto-stop there is nothing to hold off.
          if (stop === null) return Effect.void;

          return boat((client) =>
            client.setDeadline(resource.id, seconds === null ? stop : Math.max(stop, seconds)),
          ).pipe(control("hold"));
        }),
        Effect.withSpan("Compute.Boat.hold"),
      ),
    proveReplacement: (resource, previousInstanceId) =>
      descriptor.capabilities.ensure("replacement:proof").pipe(
        Effect.andThen(
          Effect.gen(function* () {
            // One machine per sandbox: while this one runs, a different boot cannot.
            const sandbox = yield* boat((client) => client.get(resource.id)).pipe(control("proof"));
            const current = live(sandbox.state) ? yield* bootId(sandbox.id) : null;

            if (current === null || current === previousInstanceId)
              return yield* new ComputeError({ provider, operation: "proof", outcome: "rejected" });

            return {
              instanceId: previousInstanceId,
              // An upper bound: the previous boot ended no later than this observation.
              endedAt: DateTime.formatIso(yield* DateTime.now),
            };
          }),
        ),
        Effect.withSpan("Compute.Boat.proveReplacement"),
      ),
    build: (input) =>
      descriptor.capabilities
        .ensure("template:build")
        .pipe(Effect.andThen(buildStep(input)), Effect.withSpan("Compute.Boat.build")),
    discardBuild: (input) =>
      descriptor.capabilities.ensure("template:build").pipe(
        Effect.andThen(
          Effect.gen(function* () {
            const progress = yield* progressOf(input);
            // A create whose answer was lost: the same key and body hand the sandbox back.
            const sandboxId =
              progress === null
                ? (yield* boat((client) => client.create(buildMachine(input))).pipe(
                    control("build"),
                  )).id
                : progress.sandboxId;

            yield* removeBuildMachine(sandboxId);
          }),
        ),
        Effect.withSpan("Compute.Boat.discardBuild"),
      ),
  };
};

/** Boat behind the devbox port, with a client built per workspace from its own sealed key. */
export const adapter = Effect.gen(function* () {
  const credentials = yield* ComputeCredentials;
  const templates = yield* Templates;
  const files = (yield* Recipe).files(provider);

  return {
    provider,
    descriptor,
    configuration,
    forWorkspace: Effect.fn("Compute.Boat.forWorkspace")(function* (workspaceId: string) {
      const stored = yield* credentials.get(workspaceId, provider);

      if (Option.isNone(stored)) return yield* new ConnectionError({ provider, reason: "missing" });

      const account = yield* Schema.decodeUnknownEffect(Account)(stored.value).pipe(
        Effect.mapError(() => new ConnectionError({ provider, reason: "invalid" })),
      );

      // The key passed the client's own credential rule above, so building it cannot refuse it.
      const client = Boat.layer.pipe(
        Layer.provide(Config.layer({ credential: Redacted.make(account.apiKey), timeoutMs })),
        Layer.orDie,
      );

      return port(workspaceId, templates, files, (effect) => effect.pipe(Effect.provide(client)));
    }),
  } satisfies ProviderAdapter;
});

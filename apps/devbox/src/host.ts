import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { Failure, type Settings } from "./settings";

const config = `onboarding = false
[update]
version_check = false
manifest_check = false
[session]
resume_agents_on_restore = false
[terminal]
default_shell = "/bin/bash"
shell_mode = "non_login"
`;

export const assertPlatform = Effect.try({
  try: () => {
    if (process.platform !== "linux" || process.arch !== "x64" || process.getuid?.() !== 1001)
      throw new Error();
  },
  catch: () => new Failure({ reason: "platform" }),
});

const validateDirectory = Effect.fn("Devbox.Host.validateDirectory")(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem;
  const stat = yield* fs.stat(directory);

  // Canonical-path equality rejects symlinks, including symlinked ancestors.
  if (
    stat.type !== "Directory" ||
    !Option.contains(stat.uid, 1001) ||
    (stat.mode & 0o7777) !== 0o700 ||
    (yield* fs.realPath(directory)) !== directory
  ) {
    return yield* new Failure({ reason: "state" });
  }
});

export const validateDirectories = Effect.fn("Devbox.Host.validateDirectories")(
  function* (settings: Settings.Service["Service"], create = false) {
    const fs = yield* FileSystem.FileSystem;

    for (const directory of [
      settings.stateRoot,
      `${settings.stateRoot}/boots`,
      settings.directory,
    ]) {
      if (create) yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 });
      yield* validateDirectory(directory);

      if (directory === settings.stateRoot) {
        // Directory entries include dangling symlinks. No old-format ownership can
        // be established here, so refuse it without inspecting or removing it.
        if ((yield* fs.readDirectory(directory)).includes("owner")) {
          return yield* new Failure({ reason: "state" });
        }
      }
    }

    if (!create) yield* validateDirectory(`${settings.directory}/owner`);
  },
  Effect.mapError(() => new Failure({ reason: "state" })),
);

export const acquireDirectory = Effect.fn("Devbox.Host.acquireDirectory")(function* (
  settings: Settings.Service["Service"],
) {
  const fs = yield* FileSystem.FileSystem;
  const directory = settings.directory;

  yield* validateDirectories(settings, true);

  // Only atomic creation in this boot grants ownership. Never consult old PIDs,
  // probe a free flock, or adopt/remove an owner, even after a same-kernel crash.
  yield* Effect.acquireRelease(
    fs
      .makeDirectory(`${directory}/owner`, { mode: 0o700 })
      .pipe(Effect.mapError(() => new Failure({ reason: "locked" }))),
    () => fs.remove(`${directory}/owner`, { recursive: true, force: true }).pipe(Effect.orDie),
  );
});

// rc.112's spawner waits for the leader, not the detached group, and skips
// cleanup after a successful leader exit. Own group cleanup before its finalizer.
export const signalGroup = Effect.fn("Devbox.Host.signalGroup")(
  (pid: number, signal: "SIGTERM" | "SIGKILL" | 0) =>
    Effect.sync(() => {
      try {
        process.kill(-pid, signal);
        return true;
      } catch (cause) {
        if (
          typeof cause === "object" &&
          cause !== null &&
          "code" in cause &&
          cause.code === "ESRCH"
        )
          return false;

        throw cause;
      }
    }),
);

export const launch = Effect.fn("Devbox.Host.launch")(function* (
  directory: string,
  socketPath: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const owner = `${directory}/owner`;

  yield* Effect.gen(function* () {
    yield* fs.makeDirectory(`${owner}/config`, { mode: 0o700 });
    yield* fs.makeDirectory(`${owner}/state`, { mode: 0o700 });
    yield* fs.makeDirectory(`${owner}/cache`, { mode: 0o700 });
    yield* fs.writeFileString(`${owner}/config.toml`, config, { mode: 0o600, flag: "wx" });
  }).pipe(Effect.mapError(() => new Failure({ reason: "state" })));

  return yield* Effect.uninterruptible(
    Effect.gen(function* () {
      const child = yield* spawner
        .spawn(
          ChildProcess.make("/usr/local/bin/herdr", ["server"], {
            cwd: "/workspaces",
            detached: true,
            stdin: "ignore",
            stdout: "ignore",
            stderr: "ignore",
            forceKillAfter: "5 seconds",
            extendEnv: false,
            // Never inherit provider credentials, shell hooks, or client OAuth paths.
            env: {
              HOME: "/home/devbox",
              USER: "devbox",
              LOGNAME: "devbox",
              PATH: "/usr/local/bin:/usr/bin:/bin",
              SHELL: "/bin/bash",
              TERM: "xterm-256color",
              LANG: "C.UTF-8",
              XDG_CONFIG_HOME: `${owner}/config`,
              XDG_STATE_HOME: `${owner}/state`,
              XDG_CACHE_HOME: `${owner}/cache`,
              HERDR_CONFIG_PATH: `${owner}/config.toml`,
              HERDR_SOCKET_PATH: socketPath,
            },
          }),
        )
        .pipe(Effect.mapError(() => new Failure({ reason: "spawn" })));

      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          yield* signalGroup(child.pid, "SIGTERM");

          yield* signalGroup(child.pid, 0).pipe(
            Effect.repeat({ schedule: Schedule.spaced("50 millis"), while: (alive) => alive }),
            Effect.timeoutOrElse({
              duration: "5 seconds",
              orElse: () => signalGroup(child.pid, "SIGKILL"),
            }),
          );

          yield* child.exitCode.pipe(Effect.ignore);
        }),
      );

      return child;
    }),
  );
});

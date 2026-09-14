import type { RuntimeCommand } from "@notus/control/runtime/protocol";
import type { CommandResult } from "@notus/executions/types";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import { signalGroup } from "./host";

const outputCap = 65_536;

/** Collect a stream into text, keeping only the first outputCap bytes and noting truncation. */
const collect = (stream: Stream.Stream<Uint8Array, unknown>) =>
  Effect.gen(function* () {
    const chunks: Array<Uint8Array> = [];
    let length = 0;
    let truncated = false;
    yield* stream.pipe(
      Stream.runForEach((chunk) =>
        Effect.sync(() => {
          if (length >= outputCap) {
            truncated = true;
            return;
          }
          const room = outputCap - length;
          const slice = chunk.byteLength > room ? chunk.subarray(0, room) : chunk;
          if (chunk.byteLength > room) truncated = true;
          chunks.push(slice);
          length += slice.byteLength;
        }),
      ),
      Effect.ignore,
    );
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { text: new TextDecoder("utf-8", { fatal: false }).decode(bytes), truncated };
  });

const baseEnv = {
  HOME: "/home/devbox",
  USER: "devbox",
  LOGNAME: "devbox",
  PATH: "/usr/local/bin:/usr/bin:/bin",
  SHELL: "/bin/bash",
  TERM: "dumb",
  LANG: "C.UTF-8",
};

/** Git receives the read token through configuration variables for this process only. */
const gitEnv = (credential: string | null) =>
  credential === null
    ? { ...baseEnv, GIT_TERMINAL_PROMPT: "0" }
    : {
        ...baseEnv,
        GIT_TERMINAL_PROMPT: "0",
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
        GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${btoa(`x-access-token:${credential}`)}`,
      };

/** Clone at the default branch, or report an existing checkout, then read HEAD. */
const checkoutScript = (spec: Extract<RuntimeCommand["spec"], { kind: "checkout" }>) => {
  const url = `https://github.com/${spec.repository.owner}/${spec.repository.name}.git`;
  const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
  return [
    "set -eu",
    `path=${quote(spec.path)}`,
    `if [ -d "$path/.git" ]; then echo "existing checkout" >&2; else`,
    `  git clone --quiet --branch ${quote(spec.repository.defaultBranch)} --single-branch --depth 50 ${quote(url)} "$path"`,
    "fi",
    `git -C "$path" rev-parse HEAD`,
  ].join("\n");
};

/**
 * One bash command as the devbox user with a fixed environment. The supervisor's own
 * environment, including callback credentials, is never inherited. A checkout's read token
 * exists only in that git process's environment.
 */
export const run = Effect.fn("Devbox.Commands.run")(function* (
  command: RuntimeCommand,
): Effect.fn.Return<CommandResult, never, ChildProcessSpawner.ChildProcessSpawner> {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const startedAt = yield* Clock.currentTimeMillis;
  const failure = (durationMs: number, stderr: string): CommandResult => ({
    exitCode: null,
    stdout: "",
    stderr,
    durationMs,
    timedOut: false,
    truncated: false,
  });
  const spec = command.spec;
  const script = spec.kind === "shell" ? spec.script : checkoutScript(spec);
  const cwd = spec.kind === "shell" ? spec.cwd : "/workspaces";
  const env = spec.kind === "shell" ? baseEnv : gitEnv(command.credential);
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const child = yield* spawner.spawn(
        ChildProcess.make("/bin/bash", ["-c", script], {
          cwd,
          detached: true,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          forceKillAfter: "5 seconds",
          extendEnv: false,
          env,
        }),
      );
      yield* Effect.addFinalizer(() =>
        signalGroup(child.pid, "SIGTERM").pipe(
          Effect.andThen(signalGroup(child.pid, "SIGKILL")),
          Effect.ignore,
        ),
      );
      let timedOut = false;
      const [stdout, stderr, exit] = yield* Effect.all(
        [
          collect(child.stdout),
          collect(child.stderr),
          child.exitCode.pipe(
            Effect.map((code): number | null => Number(code)),
            // A signal-terminated process has no exit code; that is a result, not a failure.
            Effect.orElseSucceed((): number | null => null),
            Effect.timeoutOrElse({
              duration: command.spec.timeoutMs,
              // Kill the whole group at the deadline so the output streams close promptly.
              orElse: () =>
                Effect.sync(() => {
                  timedOut = true;
                }).pipe(
                  Effect.andThen(signalGroup(child.pid, "SIGTERM")),
                  Effect.andThen(Effect.sleep("2 seconds")),
                  Effect.andThen(signalGroup(child.pid, "SIGKILL")),
                  Effect.ignore,
                  Effect.as<number | null>(null),
                ),
            }),
          ),
        ],
        { concurrency: "unbounded" },
      );
      const durationMs = (yield* Clock.currentTimeMillis) - startedAt;
      const result: CommandResult = {
        exitCode: exit,
        stdout: stdout.text,
        stderr: stderr.text,
        durationMs,
        timedOut,
        truncated: stdout.truncated || stderr.truncated,
      };
      if (spec.kind !== "checkout" || exit !== 0) return result;
      const headSha = stdout.text.trim().split("\n").at(-1) ?? "";
      if (!/^[0-9a-f]{40}$/.test(headSha)) return result;
      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs,
        timedOut: result.timedOut,
        truncated: result.truncated,
        checkout: { path: spec.path, branch: spec.repository.defaultBranch, headSha },
      };
    }),
  ).pipe(
    Effect.catch(() =>
      Effect.map(Clock.currentTimeMillis, (now) =>
        failure(now - startedAt, "the command could not be started"),
      ),
    ),
  );
});

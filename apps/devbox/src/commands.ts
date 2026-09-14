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

/** Commit everything in the checkout as the App's bot identity and push the task branch. */
const pushScript = (spec: Extract<RuntimeCommand["spec"], { kind: "push" }>) => {
  const url = `https://github.com/${spec.repository.owner}/${spec.repository.name}.git`;
  const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
  return [
    "set -eu",
    `path=${quote(spec.path)}`,
    `[ -d "$path/.git" ] || { echo "no checkout at $path" >&2; exit 3; }`,
    `cd "$path"`,
    `git checkout --quiet -B ${quote(spec.branch)}`,
    "git add -A",
    // Commit only new changes. A commit left by an earlier failed push is still published, so a
    // retry after a transient failure works instead of stopping at "nothing to commit".
    `if ! git diff --cached --quiet; then git -c user.name='Notus' -c user.email='notus[bot]@users.noreply.github.com' commit --quiet -m ${quote(spec.message)}; fi`,
    `base=$(git rev-parse --verify --quiet ${quote(`refs/remotes/origin/${spec.repository.defaultBranch}`)} || true)`,
    `if [ -n "$base" ] && [ "$(git rev-parse HEAD)" = "$base" ]; then echo "nothing to publish" >&2; exit 4; fi`,
    `git push --quiet ${quote(url)} ${quote(`HEAD:refs/heads/${spec.branch}`)}`,
    "git rev-parse HEAD",
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
  if (spec.kind === "pull-request")
    return failure(0, "pull requests are opened by control, never on the box");
  const script =
    spec.kind === "shell"
      ? spec.script
      : spec.kind === "checkout"
        ? checkoutScript(spec)
        : pushScript(spec);
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
      if (spec.kind === "shell" || exit !== 0) return result;
      const headSha = stdout.text.trim().split("\n").at(-1) ?? "";
      if (!/^[0-9a-f]{40}$/.test(headSha)) return result;
      const base = {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs,
        timedOut: result.timedOut,
        truncated: result.truncated,
      };
      return spec.kind === "checkout"
        ? { ...base, checkout: { path: spec.path, branch: spec.repository.defaultBranch, headSha } }
        : { ...base, push: { branch: spec.branch, headSha } };
    }),
  ).pipe(
    Effect.catch(() =>
      Effect.map(Clock.currentTimeMillis, (now) =>
        failure(now - startedAt, "the command could not be started"),
      ),
    ),
  );
});

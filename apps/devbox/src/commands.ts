import type { Command, CommandResult } from "@notus/executions/types";
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

/**
 * One bash command as the devbox user with a fixed environment. The supervisor's own
 * environment, including callback credentials, is never inherited.
 */
export const run = Effect.fn("Devbox.Commands.run")(function* (
  command: Command,
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
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const child = yield* spawner.spawn(
        ChildProcess.make("/bin/bash", ["-c", command.spec.script], {
          cwd: command.spec.cwd,
          detached: true,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          forceKillAfter: "5 seconds",
          extendEnv: false,
          env: {
            HOME: "/home/devbox",
            USER: "devbox",
            LOGNAME: "devbox",
            PATH: "/usr/local/bin:/usr/bin:/bin",
            SHELL: "/bin/bash",
            TERM: "dumb",
            LANG: "C.UTF-8",
          },
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
      return {
        exitCode: exit,
        stdout: stdout.text,
        stderr: stderr.text,
        durationMs,
        timedOut,
        truncated: stdout.truncated || stderr.truncated,
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

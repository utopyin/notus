import type { RuntimeCommand } from "@notus/control/runtime/protocol";
import type { CommandResult } from "@notus/executions/types";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import { Git, home } from "./git";
import { signalGroup } from "./host";
import { Settings } from "./settings";

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
  HOME: home,
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

/**
 * Clone the remote's default branch or a pull request's head branch, or switch an existing
 * checkout to it, then print the default branch, the branch and HEAD. A pull request's head
 * branch is the branch at the same commit as its pull ref; only branches of this repository
 * qualify, so a fork's pull request has none.
 */
const checkoutScript = (spec: Extract<RuntimeCommand["spec"], { kind: "checkout" }>) => {
  const url = `https://github.com/${spec.repository.owner}/${spec.repository.name}.git`;
  const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
  const pull = spec.pullRequest;
  return [
    "set -eu",
    `path=${quote(spec.path)}`,
    `url=${quote(url)}`,
    `default=$(git ls-remote --symref "$url" HEAD | awk '/^ref:/ { sub("refs/heads/", "", $2); print $2; exit }')`,
    `[ -n "$default" ] || { echo "the remote reports no default branch" >&2; exit 3; }`,
    ...(pull === undefined
      ? [`branch="$default"`]
      : [
          `sha=$(git ls-remote "$url" ${quote(`refs/pull/${pull}/head`)} | cut -f1)`,
          `[ -n "$sha" ] || { echo "pull request #${pull} was not found in this repository" >&2; exit 3; }`,
          `branch=$(git ls-remote --heads "$url" | awk -v sha="$sha" '$1 == sha { sub("refs/heads/", "", $2); print $2; exit }')`,
          `[ -n "$branch" ] || { echo "the head branch of pull request #${pull} is not in this repository" >&2; exit 3; }`,
        ]),
    `if [ -d "$path/.git" ]; then`,
    `  echo "existing checkout" >&2`,
    // Only a different branch moves the checkout; a repeat lands where it is, local commits intact.
    `  if [ "$(git -C "$path" rev-parse --abbrev-ref HEAD)" != "$branch" ]; then`,
    `    git -C "$path" fetch --quiet --depth 50 "$url" "refs/heads/$branch:refs/remotes/origin/$branch"`,
    `    git -C "$path" checkout --quiet -B "$branch" "refs/remotes/origin/$branch"`,
    "  fi",
    "else",
    `  git clone --quiet --single-branch --branch "$branch" --depth 50 "$url" "$path"`,
    "fi",
    `echo "$default"`,
    `git -C "$path" rev-parse --abbrev-ref HEAD`,
    `git -C "$path" rev-parse HEAD`,
  ].join("\n");
};

/**
 * One specialist round through the Herdr CLI: sign Codex in with the round's login file, start or
 * reuse the named agent in the checkout, submit the instructions, wait for it to settle and print
 * the report it wrote. Instructions and login arrive through the environment, never the script text.
 */
const specialistScript = (
  spec: Extract<RuntimeCommand["spec"], { kind: "specialist" }>,
  commandId: string,
) => {
  const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
  const promptTimeout = Math.max(60_000, spec.timeoutMs - 60_000);
  return [
    "set -u",
    `path=${quote(spec.path)}`,
    `agent=${quote(spec.agent)}`,
    `[ -d "$path/.git" ] || { echo "no checkout at $path; run checkout_repository first" >&2; exit 3; }`,
    'rounds="$HOME/.local/state/notus/rounds"',
    'mkdir -p "$rounds" && chmod 700 "$rounds"',
    `report="$rounds/${commandId}.md"`,
    'rm -f "$report"',
    "umask 077",
    'mkdir -p "$HOME/.codex"',
    'printf \'%s\' "$NOTUS_AGENT_AUTH" > "$HOME/.codex/auth.json"',
    "unset NOTUS_AGENT_AUTH",
    // Trust the checkout and skip update prompts so the agent never stops at a startup dialog.
    // TOML: the project path is a quoted key under [projects].
    `printf 'check_for_update_on_startup = false\n\n[projects."%s"]\ntrust_level = "trusted"\n' "$path" > "$HOME/.codex/config.toml"`,
    'if ! herdr agent get "$agent" >/dev/null 2>&1; then',
    '  created=$(herdr workspace create --cwd "$path" --label "$agent" --no-focus) || { echo "herdr could not create a workspace" >&2; exit 5; }',
    "  pane=$(printf '%s' \"$created\" | jq -r '.result.root_pane.pane_id')",
    '  herdr agent start "$agent" --kind codex --pane "$pane" --timeout 120000 -- --dangerously-bypass-approvals-and-sandbox >/dev/null 2>"$rounds/start.err" || { echo "codex did not start:" >&2; tail -c 2000 "$rounds/start.err" >&2; herdr agent read "$agent" --source recent-unwrapped --lines 40 >&2 2>/dev/null; exit 6; }',
    "fi",
    'instructions="$NOTUS_INSTRUCTIONS',
    "",
    'When the work is finished, write your final report as Markdown to $report: what you changed, how you checked it, and anything left open. Unless the instructions above say otherwise, do not commit or push. Then reply with the single word DONE."',
    "unset NOTUS_INSTRUCTIONS",
    `herdr agent prompt "$agent" "$instructions" --wait --until idle --until done --timeout ${promptTimeout} >/dev/null 2>"$rounds/prompt.err"`,
    "waited=$?",
    'if [ -s "$report" ]; then head -c 60000 "$report"; exit 0; fi',
    'echo "the agent settled without writing its report (wait exit $waited):" >&2',
    'tail -c 1000 "$rounds/prompt.err" >&2',
    'herdr agent read "$agent" --source recent-unwrapped --lines 60 >&2 2>/dev/null',
    "exit 7",
  ].join("\n");
};

/**
 * Commit everything in the checkout and push the task branch. Signed in as the initiator, the
 * commit carries their identity and the push their token; otherwise the App's bot identity and
 * the command's own write token.
 */
const pushScript = (spec: Extract<RuntimeCommand["spec"], { kind: "push" }>, asPerson: boolean) => {
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
    `if ! git diff --cached --quiet; then git ${asPerson ? "" : "-c user.name='Notus' -c user.email='notus[bot]@users.noreply.github.com' "}commit --quiet -m ${quote(spec.message)}; fi`,
    // Nothing to publish when HEAD is what the remote branch already has, or, for a branch that
    // is new to the remote, what the default branch has.
    `base=$(git rev-parse --verify --quiet ${quote(`refs/remotes/origin/${spec.branch}`)} || git rev-parse --verify --quiet refs/remotes/origin/HEAD || true)`,
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
): Effect.fn.Return<
  CommandResult,
  never,
  ChildProcessSpawner.ChildProcessSpawner | Settings.Service | FileSystem.FileSystem
> {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fs = yield* FileSystem.FileSystem;
  const settings = yield* Settings.Service;
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
  const asPerson = spec.kind === "push" && (yield* Git.signedIn());
  const script =
    spec.kind === "shell"
      ? spec.script
      : spec.kind === "checkout"
        ? checkoutScript(spec)
        : spec.kind === "specialist"
          ? specialistScript(spec, command.id)
          : pushScript(spec, asPerson);
  const cwd = spec.kind === "shell" ? spec.cwd : "/workspaces";
  const env =
    spec.kind === "shell"
      ? baseEnv
      : spec.kind === "specialist"
        ? {
            ...baseEnv,
            HERDR_SOCKET_PATH: settings.socketPath,
            HERDR_CONFIG_PATH: `${settings.directory}/owner/config.toml`,
            NOTUS_AGENT_AUTH: command.credential ?? "",
            NOTUS_INSTRUCTIONS: spec.instructions,
          }
        : gitEnv(asPerson ? null : command.credential);
  return yield* Effect.scoped(
    Effect.gen(function* () {
      // Namespace keeps a box running while a file exists under /.namespace/tasks, so work on the
      // box is never stopped as idle mid-command. Best effort: a missing directory only logs.
      const marker = `/.namespace/tasks/notus-${command.id}`;
      yield* fs.makeDirectory("/.namespace/tasks", { recursive: true }).pipe(
        Effect.andThen(fs.writeFileString(marker, `${spec.kind}\n`)),
        Effect.catch(() => Effect.logWarning("devbox.idle_marker_unavailable")),
      );
      yield* Effect.addFinalizer(() => fs.remove(marker, { force: true }).pipe(Effect.ignore));
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
      const base = {
        exitCode: exit,
        stdout: stdout.text,
        stderr: stderr.text,
        durationMs,
        timedOut,
        truncated: stdout.truncated || stderr.truncated,
      };
      const result: CommandResult = base;
      // The report is what the round printed; a non-zero exit carries the diagnostics in stderr.
      if (spec.kind === "specialist")
        return exit === 0 ? { ...base, specialist: { report: stdout.text } } : result;
      if (spec.kind === "shell" || exit !== 0) return result;
      const lines = stdout.text.trim().split("\n");
      const headSha = lines.at(-1) ?? "";
      if (!/^[0-9a-f]{40}$/.test(headSha)) return result;
      // The checkout script prints the default branch, then the branch, then HEAD.
      const branch = lines.at(-2) ?? "";
      const defaultBranch = lines.at(-3) ?? "";
      return spec.kind === "checkout"
        ? {
            ...base,
            checkout: {
              path: spec.path,
              branch,
              headSha,
              ...(defaultBranch === "" ? {} : { defaultBranch }),
            },
          }
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

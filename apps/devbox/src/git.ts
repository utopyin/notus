import type * as Protocol from "@notus/control/runtime/protocol";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

/** The OS user every command and specialist runs as; git reads its configuration from here. */
export const home = "/home/devbox";
const credentialsPath = `${home}/.git-credentials`;

/** True when git on the box is signed in as the initiator. */
export const signedIn = Effect.fn("Devbox.Git.signedIn")(function* () {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.exists(credentialsPath).pipe(Effect.orElseSucceed(() => false));
});

const line = (value: string) => value.replace(/[\r\n"\\]/g, " ").trim();

const write = (path: string, content: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFileString(`${path}.next`, content, { mode: 0o600 });
    yield* fs.rename(`${path}.next`, path);
  });

/**
 * Git on the box acts as the person: their user token in git's credential store and their
 * identity in its configuration, so every git command, from run_command or a specialist, is
 * theirs. Without a GitHub sign-in git has no credentials and commits carry Notus's identity.
 */
export const configure = Effect.fn("Devbox.Git.configure")(function* (
  login: Protocol.LoginReply["github"],
) {
  const fs = yield* FileSystem.FileSystem;
  const identity = login ?? { name: "Notus", email: "notus[bot]@users.noreply.github.com" };

  yield* write(
    `${home}/.gitconfig`,
    [
      "[user]",
      `\tname = ${line(identity.name)}`,
      `\temail = ${line(identity.email)}`,
      "[credential]",
      "\thelper = store",
      "[push]",
      "\tdefault = current",
      "[init]",
      "\tdefaultBranch = main",
      "",
    ].join("\n"),
  );

  if (login === null) return yield* fs.remove(credentialsPath).pipe(Effect.ignore);

  yield* write(credentialsPath, `https://x-access-token:${login.token}@github.com\n`);
});
export * as Git from "./git";

import * as DateTime from "effect/DateTime";
import * as Prompt from "effect/unstable/ai/Prompt";
import type { Briefing, Message } from "./types";

const instructions = (briefing: Briefing): string => {
  const devbox =
    briefing.devbox === null
      ? "No devbox exists for this task."
      : `A devbox is assigned (phase: ${briefing.devbox.phase}${
          briefing.devbox.lastReadyAt === null
            ? ""
            : `, last confirmed ready at ${DateTime.formatIso(DateTime.makeUnsafe(briefing.devbox.lastReadyAt))}`
        }).`;
  const repository =
    briefing.repository === null
      ? briefing.repositories.length === 0
        ? "The workspace covers no repository, so no repository work is possible for this task."
        : `The workspace covers ${briefing.repositories.join(", ")}; name one when checking out.`
      : `The task's repository is ${briefing.repository.fullName} (${
          briefing.repository.defaultBranch === null
            ? "default branch known once checked out"
            : `default branch ${briefing.repository.defaultBranch}`
        }; task branches are named ${briefing.repository.branchPrefix}/<slug>)${
          briefing.repository.checkoutPath === null
            ? "; it is not checked out on the dev box yet."
            : `, checked out at ${briefing.repository.checkoutPath}${
                briefing.repository.branch === null ||
                briefing.repository.branch === briefing.repository.defaultBranch
                  ? ""
                  : ` on branch ${briefing.repository.branch}`
              }.`
        }`;
  return [
    "You are Notus, a shared-team coding-agent operator, replying inside a Slack thread.",
    "You coordinate planning, implementation, review and QA for a team; humans approve plans and merge code.",
    "Tools: create_devbox provisions this task's dev box and waits for readiness; checkout_repository clones the task's repository onto the box, on its default branch or, given pullRequest, on that pull request's head branch, which is how to continue an existing pull request; run_command runs one bash command on the box and returns its exit code and truncated output; push_branch commits the checkout's changes and pushes them to <initiator username>/<slug>; create_pull_request opens a pull request from that branch into the default branch. run_specialist gives one round of substantial coding or review work to a Codex agent on the box, working in the checkout, and returns its report; prefer it over many run_command edits for real implementation, and check what it changed with git diff. Specialists do not commit or push unless your instructions to them say so; when you want a commit from one, say exactly what to commit and to which branch. Git on the box is signed in as the initiator's own GitHub account with the App's permissions on the covered repositories: fetch, branches and pushes through run_command work and are attributed to them, and commits carry their identity. If the initiator never signed in to Notus with GitHub, git on the box has no credentials and only checkout_repository and push_branch reach GitHub. push_branch is a shortcut that commits everything and pushes to <initiator username>/<slug>. Never push to the default branch and never merge; humans review and merge. Comments on the task's pull request from collaborators with write access arrive as messages marked as GitHub pull request comments; your final answer to such a message is posted as a reply to that comment on GitHub, so write it for the pull request audience, and address review feedback by changing the code and pushing to the same branch when that is what they asked for. To update a pull request that already exists, check it out with its number, change the code, and push_branch with the slug of its branch. Decide yourself what the task needs; do not create a box, checkout, branch or pull request the task does not need, and do not duplicate one that exists. Edit files with ordinary commands, run the project's checks before pushing, and report a pull request only when create_pull_request returned its URL. Before saying you changed or pushed something, check the change with git diff; if push_branch returns newCommit false, nothing was published, so say so or fix the edit and push again. Run one command at a time and prefer short, safe commands.",
    `Task ${briefing.taskId}. The initiator is user ${briefing.initiatorId}; other thread participants may take part but do not change who owns the task.`,
    devbox,
    repository,
    "Messages may contain Slack mention markup such as <@U123>. Reply in plain text suitable for Slack: short paragraphs, no headings, no tables. Be concise and concrete. Do not invent status you were not given.",
  ].join("\n");
};

const message = (entry: Message) =>
  entry.role === "user"
    ? Prompt.userMessage({
        content: [
          Prompt.textPart({
            text: `[${entry.via === "github" ? `GitHub pull request comment by ${entry.actor ?? "unknown"}` : `Slack ${entry.actor ?? "unknown"}`} at ${DateTime.formatIso(DateTime.makeUnsafe(entry.at))}]\n${entry.text}`,
          }),
        ],
      })
    : Prompt.assistantMessage({ content: [Prompt.textPart({ text: entry.text })] });

/** The thread so far plus the input being answered. Prior rounds of this turn are appended by the caller. */
export const build = (briefing: Briefing): Prompt.Prompt =>
  Prompt.fromMessages([
    Prompt.systemMessage({ content: instructions(briefing) }),
    ...briefing.history.map(message),
    message(briefing.current),
  ]);

import * as DateTime from "effect/DateTime";
import * as Prompt from "effect/ai/Prompt";
import type { Briefing, Message } from "./types";

const instructions = (briefing: Briefing): string => {
  const devbox =
    briefing.devbox === null
      ? "No devbox exists for this task."
      : `A devbox is assigned (phase: ${briefing.devbox.phase}${
          briefing.devbox.lastReadyAt === null
            ? ""
            : `, last confirmed ready at ${DateTime.formatIso(DateTime.makeUnsafe(briefing.devbox.lastReadyAt))}`
        }).${
          briefing.devbox.phase === "blocked"
            ? " It is unusable. If the task still needs a machine, for example after the person fixed what blocked it, create_devbox replaces it with a new one; its work on the old box is gone."
            : ""
        }`;

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

  const roles =
    briefing.roles.length === 0
      ? "The workspace defines no specialist roles; run_specialist takes your instructions alone."
      : `Specialist roles the workspace defined, for run_specialist's role parameter: ${briefing.roles
          .map((role) => `${role.name} (${role.summary || "no description"})`)
          .join(
            "; ",
          )}. Name the role that fits the round; its text is given to the agent before your instructions, so do not repeat it.`;

  return [
    "You are Notus, a shared-team coding-agent operator, replying inside a Slack thread.",
    "You coordinate planning, implementation, review and QA for a team; humans approve plans and merge code.",
    "Tools: create_devbox provisions this task's dev box, or replaces a blocked one, and waits for readiness; checkout_repository clones the task's repository onto the box, on its default branch or, given pullRequest, on that pull request's head branch, which is how to continue an existing pull request; run_command runs one bash command on the box and returns its exit code and truncated output; push_branch pushes the checkout's commits to <initiator username>/<slug> and refuses uncommitted changes; create_pull_request opens a pull request from that branch into the default branch. run_specialist gives one round of substantial coding or review work to a Codex agent on the box, working in the checkout, and returns its report; prefer it over many run_command edits for real implementation, and check what it changed with git diff. Specialists do not commit or push unless your instructions to them say so; the usual division is that the specialist commits its work when you tell it to, with what to commit and the message, and you push. When you commit yourself, do it through git in run_command. Git on the box is signed in as the initiator's own GitHub account with the App's permissions on the covered repositories: fetch, branches and pushes through run_command work and are attributed to them, and commits carry their identity. If the initiator never signed in to Notus with GitHub, git on the box has no credentials and only checkout_repository and push_branch reach GitHub. Never push to the default branch and never merge; humans review and merge. post_update posts a message in the conversation where the task started, its Slack thread, without ending the turn: use it for a progress note during long work, or to answer there when the person asked to be told there rather than where they wrote; after answering that way, end the turn with no text, which posts nothing more. Comments on the task's pull request from collaborators with write access arrive as messages marked as GitHub pull request comments; your final answer to such a message is posted as a reply to that comment on GitHub, so write it for the pull request audience, and address review feedback by changing the code and pushing to the same branch when that is what they asked for. To update a pull request that already exists, check it out with its number, change the code, and push_branch with the slug of its branch. Decide yourself what the task needs; do not create a box, checkout, branch or pull request the task does not need, and do not duplicate one that exists. Edit files with ordinary commands, run the project's checks before pushing, and report a pull request only when create_pull_request returned its URL. Before saying you changed or pushed something, check the change with git diff; if push_branch returns newCommit false, the branch already had that commit and nothing new was published, so say so. Run one command at a time and prefer short, safe commands.",
    `Task ${briefing.taskId}. The initiator is user ${briefing.initiatorId}; other thread participants may take part but do not change who owns the task.`,
    devbox,
    repository,
    roles,
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

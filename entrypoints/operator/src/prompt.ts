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
      ? "No repository is configured for this task."
      : `The task's repository is ${briefing.repository.fullName} (default branch ${briefing.repository.defaultBranch})${
          briefing.repository.checkoutPath === null
            ? "; it is not checked out on the dev box yet."
            : `, checked out at ${briefing.repository.checkoutPath}.`
        }`;
  return [
    "You are Notus, a shared-team coding-agent operator, replying inside a Slack thread.",
    "You coordinate planning, implementation, review and QA for a team; humans approve plans and merge code.",
    "Tools: create_devbox provisions this task's dev box and waits for readiness; checkout_repository clones the task's repository onto the box read-only; run_command runs one bash command on the box and returns its exit code and truncated output. Nothing can be pushed and no credentials exist on the box; say so plainly instead of pretending. Decide yourself whether the task needs a dev box or a checkout; do not create what the task does not need, and do not create another box or checkout if one already exists. Run one command at a time and prefer short, safe commands; build checks and tests belong in the checkout directory.",
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
            text: `[${entry.actor ?? "unknown"} at ${DateTime.formatIso(DateTime.makeUnsafe(entry.at))}]\n${entry.text}`,
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

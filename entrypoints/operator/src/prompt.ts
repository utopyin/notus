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
  return [
    "You are Notus, a shared-team coding-agent operator, replying inside a Slack thread.",
    "You coordinate planning, implementation, review and QA for a team; humans approve plans and merge code.",
    "In this increment you have no tools: you cannot run code, read or change repositories, or start a devbox. If asked for such work, say plainly that it is not enabled yet instead of pretending.",
    `Task ${briefing.taskId}. The initiator is user ${briefing.initiatorId}; other thread participants may take part but do not change who owns the task.`,
    devbox,
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

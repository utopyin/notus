import {
  IconBrain,
  IconExternalLink,
  IconGitBranch,
  IconGitPullRequest,
  IconMessage,
  IconRobot,
  IconServer,
  IconTerminal2,
  IconTool,
  IconUpload,
  type Icon,
} from "@tabler/icons-react";
import type { FC, ReactNode } from "react";
import { cn } from "cn";
import { isPlatform, slotsFor } from "../platforms";
import type { CommandView, StepItem, StepView, TaskView, TurnView } from "../server/tasks";
import { duration, plain, time } from "./status";

type Tool = Extract<StepItem, { kind: "tool" }>;

const TOOLS: Record<string, { readonly label: string; readonly icon: Icon }> = {
  create_devbox: { label: "Devbox", icon: IconServer },
  run_command: { label: "Command", icon: IconTerminal2 },
  checkout_repository: { label: "Checkout", icon: IconGitBranch },
  push_branch: { label: "Push", icon: IconUpload },
  create_pull_request: { label: "Pull request", icon: IconGitPullRequest },
  post_update: { label: "Update", icon: IconMessage },
  run_specialist: { label: "Specialist", icon: IconRobot },
};
const toolOf = (name: string) => TOOLS[name] ?? { label: name, icon: IconTool };

const json = (value: unknown) => JSON.stringify(value, null, 2);
const firstLine = (text: string) => text.split("\n").find((line) => line.trim() !== "") ?? "";

const Pre: FC<{ label: string; children: string; tone?: "error" }> = ({
  label,
  children,
  tone,
}) => (
  <div className="flex flex-col gap-1">
    <span className="text-muted-foreground text-xs">{label}</span>
    <pre
      className={cn(
        "bg-muted max-h-96 overflow-auto rounded-md p-3 font-mono text-xs break-words whitespace-pre-wrap",
        tone === "error" && "text-destructive",
      )}
    >
      {children}
    </pre>
  </div>
);

/** A pulsing dot for work still in flight, a coloured one for how it ended. */
const Dot: FC<{ state: "running" | "done" | "failed" }> = ({ state }) => (
  <span
    aria-hidden
    className={cn(
      "size-1.5 shrink-0 rounded-full",
      state === "running" && "animate-pulse bg-sky-500",
      state === "done" && "bg-emerald-500",
      state === "failed" && "bg-destructive",
    )}
  />
);

const commandState = (command: CommandView) =>
  command.status === "failed" ||
  (command.status === "done" && command.output !== null && command.output.exitCode !== 0)
    ? "failed"
    : command.status === "done"
      ? "done"
      : "running";

const CommandBody: FC<{ command: CommandView }> = ({ command }) => (
  <>
    {command.input ? (
      <Pre label={command.kind === "specialist" ? "Instructions" : "Input"}>{command.input}</Pre>
    ) : null}
    {command.status === "pending" ? (
      <p className="text-muted-foreground text-xs">Waiting for the devbox to pick it up.</p>
    ) : command.status === "claimed" ? (
      <p className="text-muted-foreground text-xs">
        Running since {time(command.claimedAt ?? command.createdAt)}.
      </p>
    ) : null}
    {command.output?.report ? <Pre label="Report">{command.output.report}</Pre> : null}
    {command.output?.stdout ? <Pre label="Output">{command.output.stdout}</Pre> : null}
    {command.output?.stderr ? (
      <Pre label="Errors" tone={command.output.exitCode === 0 ? undefined : "error"}>
        {command.output.stderr}
      </Pre>
    ) : null}
    {command.output ? (
      <p className="text-muted-foreground text-xs">
        {command.output.exitCode === null ? "No exit code" : `Exit code ${command.output.exitCode}`}
        {" · "}
        {duration(command.output.durationMs)}
        {command.output.timedOut ? " · timed out" : ""}
        {command.output.truncated ? " · output truncated" : ""}
      </p>
    ) : null}
    {command.failure ? (
      <Pre label="Failure" tone="error">
        {command.failure}
      </Pre>
    ) : null}
  </>
);

const ToolCall: FC<{ item: Tool }> = ({ item }) => {
  const tool = toolOf(item.name);
  const command = item.command;
  const state = command ? commandState(command) : item.state === "waiting" ? "running" : item.state;
  const subject = command
    ? command.kind === "shell"
      ? firstLine(command.input ?? "")
      : command.subject
    : null;
  return (
    <details className="group bg-card rounded-md border text-sm" open={state === "running"}>
      <summary className="hover:bg-accent/50 flex cursor-pointer list-none items-center gap-2 rounded-md px-3 py-2 [&::-webkit-details-marker]:hidden">
        <tool.icon className="text-muted-foreground size-4 shrink-0" />
        <span className="font-medium">{tool.label}</span>
        {subject ? (
          <span className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-xs">
            {subject}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        {command?.link ? (
          <a
            href={command.link.url}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="text-primary inline-flex items-center gap-1 text-xs hover:underline"
          >
            {command.link.label}
            <IconExternalLink className="size-3" />
          </a>
        ) : null}
        {command?.output ? (
          <span className="text-muted-foreground text-xs tabular-nums">
            {duration(command.output.durationMs)}
          </span>
        ) : null}
        <Dot state={state} />
      </summary>
      <div className="flex flex-col gap-3 border-t px-3 py-3">
        {command ? (
          <CommandBody command={command} />
        ) : (
          <>
            <Pre label="Input">{json(item.params)}</Pre>
            {item.state === "waiting" ? (
              <p className="text-muted-foreground text-xs">In progress.</p>
            ) : (
              <Pre label="Result" tone={item.state === "failed" ? "error" : undefined}>
                {json(item.result)}
              </Pre>
            )}
          </>
        )}
      </div>
    </details>
  );
};

const Step: FC<{ step: StepView }> = ({ step }) => {
  const running = step.status === "pending" || step.status === "running";
  return (
    <li className="relative flex flex-col gap-2 pl-6">
      <span
        aria-hidden
        className={cn(
          "bg-background absolute top-1.5 left-0 size-2.5 rounded-full border-2",
          running || step.status === "waiting"
            ? "animate-pulse border-sky-500"
            : step.status === "failed"
              ? "border-destructive"
              : "border-muted-foreground/40",
        )}
      />
      <span className="text-muted-foreground flex items-center gap-2 text-xs">
        Step {step.index + 1}
        <span>·</span>
        {time(step.updatedAt)}
        {step.tokens !== null ? (
          <>
            <span>·</span>
            <span className="tabular-nums">{step.tokens.toLocaleString()} tokens</span>
          </>
        ) : null}
        {step.attempts > 1 ? (
          <>
            <span>·</span>
            {step.attempts} attempts
          </>
        ) : null}
      </span>
      {running && step.items.length === 0 ? (
        <span className="text-muted-foreground animate-pulse text-sm">
          {step.attempts > 0 && step.failure ? `Retrying after ${step.failure}` : "Thinking"}
        </span>
      ) : null}
      {step.items.map((item, index) =>
        item.kind === "text" ? (
          <p key={index} className="text-sm whitespace-pre-wrap">
            {item.text}
          </p>
        ) : item.kind === "reasoning" ? (
          <details key={index} className="text-muted-foreground text-sm">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs [&::-webkit-details-marker]:hidden">
              <IconBrain className="size-3.5" />
              Reasoning
            </summary>
            <p className="mt-1 whitespace-pre-wrap">{item.text}</p>
          </details>
        ) : (
          <ToolCall key={item.id} item={item} />
        ),
      )}
      {step.status === "failed" && step.failure ? (
        <p className="text-destructive text-sm">The step failed: {step.failure}</p>
      ) : null}
    </li>
  );
};

const Bubble: FC<{ label: ReactNode; at: number; children: ReactNode; aside?: ReactNode }> = ({
  label,
  at,
  children,
  aside,
}) => (
  <div className="bg-card flex flex-col gap-2 rounded-lg border p-4">
    <div className="text-muted-foreground flex items-center gap-2 text-xs">
      {label}
      <span>·</span>
      {time(at)}
      <span className="flex-1" />
      {aside}
    </div>
    {children}
  </div>
);

const DELIVERY: Record<string, string> = {
  pending: "Sending",
  sending: "Sending",
  confirmed: "Delivered",
  rejected: "Rejected",
  ambiguous: "Delivery unknown",
  skipped: "Not sent",
};

const Turn: FC<{ turn: TurnView; first: boolean }> = ({ turn, first }) => {
  const Mark = isPlatform(turn.platform) ? slotsFor(turn.platform).Mark : IconMessage;
  return (
    <section className="flex flex-col gap-4">
      <Bubble
        label={
          <span className="inline-flex items-center gap-1.5">
            <Mark className="size-3.5" />
            {first ? "Request" : "Message"}
          </span>
        }
        at={turn.createdAt}
        aside={turn.answered ? "Answered" : null}
      >
        <p className="text-sm whitespace-pre-wrap">{plain(turn.text) || turn.text}</p>
      </Bubble>
      {turn.steps.length > 0 ? (
        <ol className="before:bg-border relative ml-1 flex flex-col gap-5 before:absolute before:inset-y-2 before:left-[4px] before:w-px">
          {turn.steps.map((step) => (
            <Step key={step.id} step={step} />
          ))}
        </ol>
      ) : null}
      {turn.responses
        .filter((response) => response.text !== "")
        .map((response) => (
          <Bubble
            key={response.id}
            label={response.final ? "Answer" : "Response"}
            at={response.createdAt}
            aside={response.delivery ? (DELIVERY[response.delivery] ?? response.delivery) : null}
          >
            <p className="text-sm whitespace-pre-wrap">{response.text}</p>
          </Bubble>
        ))}
    </section>
  );
};

/** Every input of the task in order, each with the operator's rounds and the answers it got. */
export const Timeline: FC<{ task: TaskView }> = ({ task }) => (
  <div className="flex flex-col gap-8">
    {task.timeline.map((turn, index) => (
      <Turn key={turn.inputId} turn={turn} first={index === 0} />
    ))}
  </div>
);

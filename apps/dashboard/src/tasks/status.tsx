import type { FC } from "react";
import { cn } from "cn";
import type { TaskRow } from "../server/tasks";

type Status = TaskRow["status"];

const LABELS: { readonly [S in Status]: string } = {
  queued: "Queued",
  working: "Working",
  waiting: "Waiting",
  idle: "Idle",
  failed: "Failed",
  closed: "Closed",
};
const DOTS: { readonly [S in Status]: string } = {
  queued: "bg-muted-foreground/40",
  working: "bg-sky-500 animate-pulse",
  waiting: "bg-amber-500 animate-pulse",
  idle: "bg-emerald-500",
  failed: "bg-destructive",
  closed: "bg-muted-foreground/40",
};

/** Running statuses pulse; settled ones hold still. */
export const StatusDot: FC<{ status: Status; className?: string }> = ({ status, className }) => (
  <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOTS[status], className)} />
);

export const StatusLabel: FC<{ status: Status }> = ({ status }) => (
  <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
    <StatusDot status={status} className="size-1.5" />
    {LABELS[status]}
  </span>
);

/** Platform message text, readable: mentions dropped, links shown by their label. */
export const plain = (text: string) =>
  text
    .replace(/<@[^>]+>/g, "")
    .replace(/<([^>|]+)\|([^>]+)>/g, "$2")
    .replace(/<(https?:[^>]+)>/g, "$1")
    .trim();

export const when = (millis: number) =>
  new Date(millis).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
export const time = (millis: number) =>
  new Date(millis).toLocaleTimeString(undefined, { timeStyle: "medium" });
export const duration = (millis: number) => {
  if (millis < 1_000) return `${millis} ms`;
  const seconds = Math.round(millis / 1_000);
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
};

import type { FC } from "react";
import type { WorkspaceView } from "../server/workspaces";
import { GithubDetails } from "./github/details";
import { GithubIcon } from "./github/icon";
import type { Installation } from "./scopes";
import { SlackDetails } from "./slack/details";
import { SlackIcon } from "./slack/icon";

export type Platform = WorkspaceView["installations"][number]["platform"];
export const PLATFORMS: ReadonlyArray<Platform> = ["slack", "github"];

/**
 * What the dashboard knows about a platform beyond its descriptor: the brand mark, copy, and the
 * component that renders its details. Generic pages pick a slot by platform and never branch on
 * the name themselves; a platform without a slot set is a compile error here.
 */
export interface PlatformSlots {
  readonly name: string;
  readonly Mark: FC<{ className?: string }>;
  /** One line for the platform card. */
  readonly description: string;
  readonly installLabel: string;
  /** The platform's page once installed: its scopes and whatever else it needs. */
  readonly Details: FC<{ view: WorkspaceView; installation: Installation; isAdmin: boolean }>;
}

const SLOTS: { readonly [P in Platform]: PlatformSlots } = {
  slack: {
    name: "Slack",
    Mark: SlackIcon,
    description: "Mention Notus in a channel to start a task; it answers in the thread.",
    installLabel: "Add to Slack",
    Details: SlackDetails,
  },
  github: {
    name: "GitHub",
    Mark: GithubIcon,
    description: "Notus opens pull requests here and takes review feedback on them.",
    installLabel: "Install GitHub App",
    Details: GithubDetails,
  },
};

export const slotsFor = (platform: Platform): PlatformSlots => SLOTS[platform];
export const isPlatform = (value: string): value is Platform =>
  (PLATFORMS as ReadonlyArray<string>).includes(value);

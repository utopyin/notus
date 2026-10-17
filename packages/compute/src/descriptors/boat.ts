import { Capabilities } from "../capabilities";
import type { ProviderDescriptor } from "../descriptor";

/**
 * From Boat's documentation and the live probe (docs/research/boat.md). Boat never stops an idle
 * box by itself: it stops at a fixed deadline, which nothing inside the box can push back, so
 * neither `sleep:auto` nor `busy:signal` holds. Notus moves that deadline through the API while
 * the box works instead (`activity:lease`). A sandbox has one machine at a time, and the
 * adapter reads that machine's boot id through Boat's API, so a new boot id proves the previous
 * machine ended.
 */
export const BOAT_DESCRIPTOR: ProviderDescriptor<"boat"> = {
  provider: "boat",
  name: "Boat",
  icon: "boat",
  capabilities: new Capabilities({
    provider: "boat",
    values: ["sleep:request", "wake:request", "replacement:proof", "activity:lease"],
  }),
  template: {
    noun: { one: "snapshot", many: "snapshots" },
    placeholder: "notus-base",
  },
  connection: {
    label: "API key",
    placeholder: "boat_…",
    help: "A Boat API key for the workspace's own account, such as one from `boat api-key create notus --preset ci`. Notus seals it and never shows it again.",
  },
};

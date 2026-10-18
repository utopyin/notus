import { Capabilities } from "../capabilities";
import type { ProviderDescriptor } from "../descriptor";

/**
 * Boat stops a box at a fixed deadline, whatever the box is doing, and nothing inside the box can
 * push it back, so neither `sleep:auto` nor `busy:signal` holds. Notus moves that deadline
 * through the API while the box works (`activity:lease`). A sandbox has one machine at a time, and the
 * adapter reads that machine's boot id through Boat's API, so a new boot id proves the previous
 * machine ended. Boat has no image build, but its API can run the Notus recipe on a plain machine
 * and save it as a named snapshot, so Notus builds the template itself (`template:build`).
 */
export const BOAT_DESCRIPTOR: ProviderDescriptor<"boat"> = {
  provider: "boat",
  name: "Boat",
  icon: "boat",
  capabilities: new Capabilities({
    provider: "boat",
    values: [
      "sleep:request",
      "wake:request",
      "replacement:proof",
      "activity:lease",
      "template:build",
    ],
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

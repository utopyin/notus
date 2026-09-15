import { Capabilities } from "../capabilities";
import type { PlatformDescriptor } from "../descriptor";

export const SLACK_DESCRIPTOR: PlatformDescriptor<"slack"> = {
  platform: "slack",
  name: "Slack",
  icon: "slack",
  scopeNoun: "channel",
  scopeLabel: (scope) => `#${scope.label || scope.id}`,
  capabilities: new Capabilities({
    platform: "slack",
    values: [
      "input:start",
      "input:message",
      "output:update",
      "output:reply",
      "output:react",
      "scope:list",
    ],
  }),
};

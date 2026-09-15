import { Capabilities } from "../capabilities";
import type { PlatformDescriptor } from "../descriptor";

export const GITHUB_DESCRIPTOR: PlatformDescriptor<"github"> = {
  platform: "github",
  name: "GitHub",
  icon: "github",
  scopeNoun: { one: "repository", many: "repositories" },
  scopeLabel: (scope) => scope.label || scope.id,
  capabilities: new Capabilities({
    platform: "github",
    values: [
      "input:message",
      "input:review",
      "output:reply",
      "output:react",
      "scope:list",
      "conversation:open",
    ],
  }),
};

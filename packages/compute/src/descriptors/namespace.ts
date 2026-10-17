import { Capabilities } from "../capabilities";
import type { ProviderDescriptor } from "../descriptor";

/**
 * Only what the code relies on today. Auto-sleep is Namespace's documented behavior and still
 * untested here (docs/research/devbox-results.md); Stop exists in the client but nothing asks for it.
 */
export const NAMESPACE_DESCRIPTOR: ProviderDescriptor<"namespace"> = {
  provider: "namespace",
  name: "Namespace",
  icon: "namespace",
  capabilities: new Capabilities({
    provider: "namespace",
    values: ["sleep:auto", "sleep:request", "wake:request", "busy:signal", "replacement:proof"],
  }),
  template: {
    noun: { one: "image", many: "images" },
    placeholder: "nscr.io/tenant/name@sha256:…",
  },
  connection: {
    label: "Token",
    placeholder: "Paste a Namespace token",
    help: "A bearer token for the workspace's own Namespace tenant. Notus seals it and never shows it again.",
  },
};

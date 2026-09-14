import * as cf from "cloudflare:workers";
import type { DashboardEnv } from "../../../alchemy.run";

// TanStack Start's dev server cannot read `env` from "cloudflare:workers" at module top level,
// so bindings are read lazily through this proxy.
export const env = new Proxy({} as DashboardEnv, {
  get(_, prop) {
    return cf.env[prop as keyof typeof cf.env];
  },
});

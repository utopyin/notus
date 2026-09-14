import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Stack } from "alchemy/Stack";
import { Stage } from "alchemy/Stage";
import * as Effect from "effect/Effect";
import Api from "./apps/api/src/api";
import { hostnames, zone } from "@notus/stages/hosts";

/**
 * The dashboard: a TanStack Start app on its own Worker. It reaches the API only through the
 * service binding below; the API validates every session itself.
 */
export class Dashboard extends Cloudflare.Website.Vite<Dashboard>()(
  "Dashboard",
  Stack.useSync(({ stage }) => ({
    rootDir: "apps/dashboard",
    env: { API: Api },
    domain: { name: hostnames(stage).dashboard, zoneName: zone },
    // One origin per stage, so cookies and OAuth callbacks always agree.
    workersDev: false,
  })),
) {}
export type DashboardEnv = Cloudflare.InferEnv<typeof Dashboard>;

export default Alchemy.Stack(
  "Notus",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    // Two kinds of stage: a developer's own, named after $USER, and "production". Every stage
    // gets its own Worker, D1 database, Durable Objects and notus.run hostnames.
    yield* Stage;
    const api = yield* Api;
    const dashboard = yield* Dashboard;
    return { url: api.url, dashboardUrl: dashboard.url };
  }),
);

import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Stage } from "alchemy/Stage";
import * as Effect from "effect/Effect";
import Api from "./apps/api/src/api";

export default Alchemy.Stack(
  "Notus",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    // Two kinds of stage: a developer's own, named after $USER by default, and "production".
    // Every stage gets its own Worker, D1 database and Durable Objects.
    const stage = yield* Stage;
    if (!/^[a-z][a-z0-9-]{0,30}$/.test(stage))
      return yield* Effect.die(
        `Stage name "${stage}" must be lowercase letters, digits and dashes.`,
      );
    const api = yield* Api;
    return { url: api.url };
  }),
);

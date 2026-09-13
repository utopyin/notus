import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Stage } from "alchemy/Stage";
import * as Effect from "effect/Effect";
import Api from "./apps/api/src/api";

export default Alchemy.Stack(
  "Notus",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const stage = yield* Stage;
    if (stage !== "simulation") {
      return yield* Effect.die(
        "Notus only supports the dedicated simulation test stage; production, models and repository checkout are disabled.",
      );
    }
    const api = yield* Api;
    return { url: api.url };
  }),
);

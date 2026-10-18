import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/http/HttpRouter";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as RpcServer from "effect/rpc/RpcServer";
import * as Account from "./account";
import * as Devbox from "./devbox";
import { DashboardRpcs } from "./rpcs";
import * as Tasks from "./tasks";
import { authentication, execution } from "./viewers";
import * as Workspaces from "./workspaces";

const handlers = Layer.mergeAll(
  Account.layer,
  Workspaces.layer,
  Tasks.layer,
  Devbox.layer,
  authentication,
  execution,
  RpcSerialization.layerJson,
);

/**
 * The dashboard's API at `POST /rpc`. The handlers are built once with the host; each request
 * runs its own server, so nothing outlives the request that carried it.
 */
export const routes = HttpRouter.add(
  "POST",
  "/rpc",
  Effect.flatten(RpcServer.toHttpEffect(DashboardRpcs)),
).pipe(HttpRouter.provideRequest(handlers));

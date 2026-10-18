import { getRequestHeader } from "@tanstack/react-start/server";
import { DashboardRpcs } from "@notus/control/dashboard/rpcs";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as RpcClient from "effect/rpc/RpcClient";
import type { RpcClientError } from "effect/rpc/RpcClientError";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import { env } from "../env";

export type Client = RpcClient.FromGroup<typeof DashboardRpcs, RpcClientError>;

/** What a page receives: the value, or the reason the API refused. */
export type Result<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly reason: string };

// Every request goes through the service binding; the host name is a placeholder.
const protocol = RpcClient.layerProtocolHttp({ url: "https://api.internal/rpc" }).pipe(
  Layer.provide([
    FetchHttpClient.layer.pipe(
      Layer.provide(
        // The binding's fetch has the global signature; only runtime-specific extras differ in type.
        Layer.succeed(FetchHttpClient.Fetch, ((input, init) =>
          env.API.fetch(input, init)) as typeof globalThis.fetch),
      ),
    ),
    RpcSerialization.layerJson,
  ]),
);

/**
 * One call on the API as the signed-in user, carrying the request's cookie.
 */
export const call = <A, E extends { readonly _tag: string }>(
  run: (client: Client) => Effect.Effect<A, E>,
  cookie: string = getRequestHeader("cookie") ?? "",
): Promise<Result<A>> =>
  Effect.gen(function* () {
    const client = yield* RpcClient.make(DashboardRpcs);
    return yield* run(client);
  }).pipe(
    RpcClient.withHeaders({ cookie }),
    Effect.map((value): Result<A> => ({ ok: true, value })),
    Effect.catch((error) =>
      Effect.succeed<Result<A>>({
        ok: false,
        reason:
          "reason" in error && typeof error.reason === "string" && error._tag === "DashboardError"
            ? error.reason
            : "failed",
      }),
    ),
    Effect.catchCause((cause) =>
      Effect.logError("dashboard.api_failed", cause).pipe(
        Effect.as<Result<A>>({ ok: false, reason: "failed" }),
      ),
    ),
    Effect.scoped,
    Effect.provide(protocol),
    Effect.runPromise,
  );

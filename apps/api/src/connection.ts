import { Connections, type Seed } from "@notus/accounts/connections";
import { ConnectionError } from "@notus/accounts/errors";
import { Sealed } from "@notus/cloudflare/sealed";
import { Sqlite } from "@notus/cloudflare/sqlite";
import type { ForwardRequest, Provider } from "@notus/openai/types";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle/Cloudflare";
import { CurrentRuntimeContext, RuntimeContext } from "alchemy/RuntimeContext";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { credentialKeyConfig } from "./config";
import { cryptoLayer } from "./crypto";
import migrations from "./migrations/connection/migrations";

/**
 * One user's saved model logins, addressed by user ID. Only this object opens provider material.
 * Callers receive status, a device code to type, or forwarded provider responses, never credentials.
 */
export class Connection extends Cloudflare.DurableObject<Connection>()(
  "Connection",
  Effect.gen(function* () {
    const host = yield* Cloudflare.DurableObjectState;
    const credentialKey = yield* credentialKeyConfig.pipe(Effect.orDie);
    const context = yield* CurrentRuntimeContext;
    if (!context)
      return yield* Effect.die("Connection initialization requires Alchemy RuntimeContext");
    return { host, credentialKey, context };
  }).pipe(
    // Alchemy runs this inner initialization with its RuntimeContext.
    Effect.map(({ host, credentialKey, context }) =>
      Effect.gen(function* () {
        const db = yield* Drizzle.DurableObject({ migrations });
        const services = yield* Layer.build(
          Connections.layer.pipe(
            Layer.provide([
              Sqlite.layer(db),
              FetchHttpClient.layer,
              cryptoLayer,
              Sealed.layer(credentialKey),
            ]),
          ),
        ).pipe(Effect.orDie);
        const connections = yield* Connections.Service.pipe(Effect.provideContext(services));
        // Serializes refresh and replay decisions. Provider forwarding runs outside it.
        const gate = <A, E>(effect: Effect.Effect<A, E>) =>
          Effect.gen(function* () {
            const exit = yield* host.blockConcurrencyWhile(() => Effect.exit(effect));
            return yield* exit;
          }).pipe(Effect.provideService(RuntimeContext, context));
        const result = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
          effect.pipe(
            Effect.map((value) => ({ ok: true as const, value })),
            Effect.catch((error) =>
              Effect.succeed({
                ok: false as const,
                reason: Schema.is(ConnectionError)(error) ? error.reason : ("storage" as const),
              }),
            ),
          );
        return {
          status: (userId: string) => result(gate(connections.status(userId))),
          /** An explicit link with material in hand: the harness, or a pasted API key. */
          link: (userId: string, seed: Seed) =>
            result(
              gate(
                userId === seed.userId
                  ? connections.link(seed)
                  : Effect.fail(new ConnectionError({ reason: "unauthorized" })),
              ),
            ),
          revoke: (userId: string, provider: Provider) =>
            result(
              gate(
                Effect.gen(function* () {
                  return yield* connections.revoke(
                    userId,
                    provider,
                    yield* Clock.currentTimeMillis,
                  );
                }),
              ),
            ),
          beginDeviceLogin: (userId: string) => result(gate(connections.beginDeviceLogin(userId))),
          pollDeviceLogin: (userId: string) => result(gate(connections.pollDeviceLogin(userId))),
          /** The login goes to one dev box round, never to storage. */
          agentLogin: (userId: string, minimumLifetimeMs: number) =>
            result(gate(connections.agentLogin(userId, minimumLifetimeMs))),
          forward: (userId: string, operationId: string, request: ForwardRequest) =>
            result(connections.forward(userId, operationId, request, gate)),
        };
      }),
    ),
  ),
) {}

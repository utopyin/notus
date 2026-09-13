import { Connections } from "@notus/accounts/connections";
import { ConnectionError } from "@notus/accounts/errors";
import { Sqlite } from "@notus/cloudflare/sqlite";
import { StoredLogin, type ForwardRequest } from "@notus/openai/types";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle/Cloudflare";
import { CurrentRuntimeContext, RuntimeContext } from "alchemy/RuntimeContext";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { deploymentConfig, fixtureConnection, operatorConfig } from "./config";
import { cryptoLayer } from "./crypto";
import migrations from "./migrations/connection/migrations";

const loginJson = Schema.fromJsonString(StoredLogin);

/**
 * One saved model login per canonical user, addressed by user ID. Only this object reads
 * provider tokens. Callers receive status or forwarded provider responses, never credentials.
 */
export class Connection extends Cloudflare.DurableObject<Connection>()(
  "Connection",
  Effect.gen(function* () {
    const host = yield* Cloudflare.DurableObjectState;
    const config = yield* deploymentConfig.pipe(Effect.orDie);
    const fixture = yield* fixtureConnection.pipe(Effect.orDie);
    const operator = yield* operatorConfig.pipe(Effect.orDie);
    const context = yield* CurrentRuntimeContext;
    if (!context)
      return yield* Effect.die("Connection initialization requires Alchemy RuntimeContext");
    return { host, config, fixture, operator, context };
  }).pipe(
    // Alchemy runs this inner initialization with its RuntimeContext.
    Effect.map(({ host, config, fixture, operator, context }) =>
      Effect.gen(function* () {
        const db = yield* Drizzle.DurableObject({ migrations });
        const services = yield* Layer.build(
          Connections.layer.pipe(
            Layer.provide([Sqlite.layer(db), FetchHttpClient.layer, cryptoLayer]),
          ),
        ).pipe(Effect.orDie);
        const connections = yield* Connections.Service.pipe(Effect.provideContext(services));
        const crypto = yield* Crypto.Crypto.pipe(Effect.provide(cryptoLayer));
        // Serializes refresh and replay decisions. Provider forwarding runs outside it.
        const gate = <A, E>(effect: Effect.Effect<A, E>) =>
          Effect.gen(function* () {
            const exit = yield* host.blockConcurrencyWhile(() => Effect.exit(effect));
            return yield* exit;
          }).pipe(Effect.provideService(RuntimeContext, context));
        const fingerprintOf = (material: string) =>
          crypto.digest("SHA-256", new TextEncoder().encode(material)).pipe(
            Effect.map(Encoding.encodeHex),
            Effect.mapError(() => new ConnectionError({ reason: "storage" })),
          );
        /**
         * Only the deployment's fixture user, only the explicitly selected provider's deployment
         * secret, only while unlinked, and never the same seed twice. Revoking blocks re-seeding.
         */
        const seed = Effect.fn("Connection.seed")(function* (userId: string) {
          if (userId !== config.canonicalUserId) return;
          const status = yield* connections.status(userId);
          if (status.linked) return;
          if (operator.provider === "openai-api") {
            if (fixture.apiKey === null) return;
            const key = Redacted.value(fixture.apiKey);
            const fingerprint = yield* fingerprintOf(`openai-api:${key}`);
            if (status.seedFingerprint === fingerprint) return;
            yield* connections.link({ userId, provider: "openai-api", key, fingerprint });
            return;
          }
          if (fixture.login === null) return;
          const login = yield* Schema.decodeEffect(loginJson)(Redacted.value(fixture.login)).pipe(
            Effect.mapError(() => new ConnectionError({ reason: "invalid-input" })),
          );
          const fingerprint = yield* fingerprintOf(`${login.accountId}:${login.refresh}`);
          if (status.seedFingerprint === fingerprint) return;
          yield* connections.link({
            userId,
            provider: "openai-chatgpt",
            tokens: {
              access: login.access,
              refresh: login.refresh,
              expiresAt: Math.max(0, Math.floor(login.expires)),
              accountId: login.accountId,
            },
            fingerprint,
          });
        });
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
          status: (userId: string) =>
            result(gate(seed(userId).pipe(Effect.andThen(connections.status(userId))))),
          revoke: (userId: string) =>
            result(
              gate(
                Effect.gen(function* () {
                  return yield* connections.revoke(userId, yield* Clock.currentTimeMillis);
                }),
              ),
            ),
          forward: (userId: string, operationId: string, request: ForwardRequest) =>
            result(
              Effect.gen(function* () {
                yield* gate(seed(userId));
                return yield* connections.forward(userId, operationId, request, gate);
              }),
            ),
        };
      }),
    ),
  ),
) {}

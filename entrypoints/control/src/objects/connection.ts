import { type AgentLogin, Connections, type Seed } from "@notus/accounts/connections";
import { ConnectionError } from "@notus/accounts/errors";
import { type GithubLogin, GithubLogins } from "@notus/accounts/github-login";
import type { ConnectionStatus, DeviceLogin } from "@notus/accounts/types";
import { Sealed } from "@notus/cloudflare/sealed";
import { SharedDb } from "@notus/db/shared";
import { OAuth } from "@notus/github/oauth";
import type { ForwardRequest, ForwardResponse, Provider } from "@notus/openai/types";
import type { RuntimeContext } from "alchemy/RuntimeContext";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { credentialKeyConfig, dashboardConfig } from "../config";
import { cryptoLayer } from "../crypto";
import { Durable } from "./durable";

/** Calls cross the object boundary as values: a refusal carries its reason. */
export type Result<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly reason: ConnectionError["reason"] };

type Call<A> = Effect.Effect<Result<A>, never, RuntimeContext>;

/**
 * One user's saved model logins, addressed by user ID. Only this object opens provider material.
 * Callers receive status, a device code to type, or forwarded provider responses.
 */
// A type alias: object RPC shapes need its implicit index signature.
export type Interface = {
  readonly status: (userId: string) => Call<ReadonlyArray<ConnectionStatus>>;
  /** An explicit link with material in hand: the harness, or a pasted API key. */
  readonly link: (userId: string, seed: Seed) => Call<ConnectionStatus>;
  readonly revoke: (userId: string, provider: Provider) => Call<ConnectionStatus>;
  readonly beginDeviceLogin: (userId: string) => Call<DeviceLogin>;
  readonly pollDeviceLogin: (userId: string) => Call<DeviceLogin>;
  /** A login for one dev box round only. */
  readonly agentLogin: (userId: string, minimumLifetimeMs: number) => Call<AgentLogin>;
  readonly forward: (
    userId: string,
    operationId: string,
    request: ForwardRequest,
  ) => Call<ForwardResponse>;
  /**
   * The user's GitHub sign-in as a login for their dev box, refreshed under this object's gate so
   * concurrent tasks spend each refresh token once.
   */
  readonly githubLogin: (userId: string, minimumLifetimeMs: number) => Call<GithubLogin | null>;
};

/** @effect-expect-leaking RuntimeContext */
// oxlint-disable-next-line effecttsgo/lazy-effect -- object RPC members are calls on the stub.
export class Service extends Context.Service<Service, Interface>()(
  "@notus/control/objects/Connection",
) {}

/** A user's Connection object, by user ID; the app resolves it to the object's stub. */
export class Remote extends Context.Service<Remote, (userId: string) => Interface>()(
  "@notus/control/objects/Connection/Remote",
) {}

const result = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.map((value): Result<A> => ({ ok: true, value })),
    Effect.catch((error) =>
      Effect.succeed<Result<A>>({
        ok: false,
        reason: Schema.is(ConnectionError)(error) ? error.reason : "storage",
      }),
    ),
  );

export const layerNoDeps = Layer.effect(
  Service,
  Effect.gen(function* () {
    const durable = yield* Durable.Service;
    const connections = yield* Connections.Service;
    // Without the App's OAuth client nobody signs in with GitHub, so there is no login to serve.
    const githubLogins = yield* Effect.serviceOption(GithubLogins.Service);

    // Serializes refresh and replay decisions. Provider forwarding runs outside it.
    const gate = durable.gate;

    return Service.of({
      status: (userId) => result(gate(connections.status(userId))),
      link: (userId, seed) =>
        result(
          gate(
            userId === seed.userId
              ? connections.link(seed)
              : Effect.fail(new ConnectionError({ reason: "unauthorized" })),
          ),
        ),
      revoke: (userId, provider) =>
        result(
          gate(
            Effect.gen(function* () {
              return yield* connections.revoke(userId, provider, yield* Clock.currentTimeMillis);
            }),
          ),
        ),
      beginDeviceLogin: (userId) => result(gate(connections.beginDeviceLogin(userId))),
      pollDeviceLogin: (userId) => result(gate(connections.pollDeviceLogin(userId))),
      agentLogin: (userId, minimumLifetimeMs) =>
        result(gate(connections.agentLogin(userId, minimumLifetimeMs))),
      forward: (userId, operationId, request) =>
        result(connections.forward<RuntimeContext>(userId, operationId, request, gate)),
      githubLogin: (userId, minimumLifetimeMs) =>
        result(
          gate(
            Option.isNone(githubLogins)
              ? Effect.fail(new ConnectionError({ reason: "not-linked" }))
              : githubLogins.value.login(userId, minimumLifetimeMs),
          ),
        ),
    });
  }),
);

/**
 * Construction: reads the sealing key and the GitHub App's OAuth client, and takes the shared
 * database (GitHub sign-ins and the users they act as). The result builds one object; it leaves
 * the object's own database and its durable state to the app.
 */
export const make = Effect.gen(function* () {
  const key = yield* credentialKeyConfig;
  const github = (yield* dashboardConfig).github;
  const shared = yield* SharedDb.Service;

  const infra = Layer.mergeAll(
    Layer.succeed(SharedDb.Service, shared),
    Sealed.layer(key),
    FetchHttpClient.layer,
    cryptoLayer,
  );

  const logins =
    github === null
      ? []
      : [
          GithubLogins.layer.pipe(
            Layer.provide(
              Layer.succeed(OAuth.Configuration, {
                clientId: github.clientId,
                clientSecret: github.clientSecret,
              }),
            ),
          ),
        ];

  const object = layerNoDeps.pipe(
    Layer.provide([Connections.layer, ...logins]),
    Layer.provide(infra),
    // A malformed sealing key is a deployment defect.
    Layer.orDie,
  );

  return Effect.service(Service).pipe(Effect.provide(object));
});

export * as ConnectionObject from "./connection";

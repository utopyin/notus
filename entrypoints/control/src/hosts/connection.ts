import {
  type AgentLogin,
  Connections,
  type ConnectionStatus,
  type DeviceLogin,
  type Seed,
} from "@notus/accounts/connections";
import { ConnectionError } from "@notus/accounts/errors";
import { type GithubLogin, GithubLogins } from "@notus/accounts/github-login";
import { OAuth } from "@notus/github/oauth";
import type { ForwardRequest, ForwardResponse, Provider } from "@notus/openai/types";
import type { RuntimeContext } from "alchemy/RuntimeContext";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { cryptoLayer } from "../crypto";
import { Durable } from "./durable";

/** Calls cross the object boundary as values: a refusal carries its reason, never an error class. */
export type Result<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly reason: ConnectionError["reason"] };

type Call<A> = Effect.Effect<Result<A>, never, RuntimeContext>;

/**
 * One user's saved model logins, addressed by user ID. Only this object opens provider material.
 * Callers receive status, a device code to type, or forwarded provider responses, never credentials.
 */
// A type, not an interface: object RPC shapes need its implicit index signature.
export type Interface = {
  readonly status: (userId: string) => Call<ReadonlyArray<ConnectionStatus>>;
  /** An explicit link with material in hand: the harness, or a pasted API key. */
  readonly link: (userId: string, seed: Seed) => Call<ConnectionStatus>;
  readonly revoke: (userId: string, provider: Provider) => Call<ConnectionStatus>;
  readonly beginDeviceLogin: (userId: string) => Call<DeviceLogin>;
  readonly pollDeviceLogin: (userId: string) => Call<DeviceLogin>;
  /** The login goes to one dev box round, never to storage. */
  readonly agentLogin: (userId: string, minimumLifetimeMs: number) => Call<AgentLogin>;
  readonly forward: (
    userId: string,
    operationId: string,
    request: ForwardRequest,
  ) => Call<ForwardResponse>;
  /**
   * The user's GitHub sign-in as a login for their dev box, refreshed under this object's gate so
   * concurrent tasks never spend the same refresh token twice. Never stored here.
   */
  readonly githubLogin: (userId: string, minimumLifetimeMs: number) => Call<GithubLogin | null>;
};

/**
 * Methods run inside an object or Worker handler, which supplies the runtime context.
 *
 * @effect-expect-leaking RuntimeContext
 */
export class Service extends Context.Service<Service, Interface>()(
  "@notus/control/hosts/Connection",
) {}

/** Another user's Connection object, by user ID; the app resolves it to the object's stub. */
export class Remote extends Context.Service<Remote, (userId: string) => Interface>()(
  "@notus/control/hosts/Connection/Remote",
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

/** The GitHub App's OAuth client, when the deployment signs users in with GitHub. */
export interface Settings {
  readonly github: {
    readonly clientId: string;
    readonly clientSecret: Redacted.Redacted<string>;
  } | null;
}

/**
 * Leaves the object's own database, the shared database (GitHub sign-ins and the users they act
 * as), the sealing key and the object host to the app.
 */
export const layer = (settings: Settings) => {
  const connections = Connections.layer.pipe(Layer.provide([FetchHttpClient.layer, cryptoLayer]));

  if (settings.github === null) return layerNoDeps.pipe(Layer.provide(connections));

  const githubLogins = GithubLogins.layer.pipe(
    Layer.provide([
      FetchHttpClient.layer,
      Layer.succeed(OAuth.Configuration, {
        clientId: settings.github.clientId,
        clientSecret: settings.github.clientSecret,
      }),
    ]),
  );

  return layerNoDeps.pipe(Layer.provide([connections, githubLogins]));
};

export * as ConnectionHost from "./connection";

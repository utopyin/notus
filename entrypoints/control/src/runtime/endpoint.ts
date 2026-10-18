import { Commands } from "@notus/executions/commands";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { Alarm } from "../alarm";
import { Durable } from "../objects/durable";
import { Tokens } from "../tokens";
import type * as Auth from "./auth";
import { Failure } from "./errors";
import * as Protocol from "./protocol";
import { Server } from "./server";

type Enrollment = Extract<Auth.Capability, { readonly _tag: "Enrollment" }>;
type Readiness = Extract<Auth.Capability, { readonly _tag: "Readiness" }>;

const unauthorized = () => new Failure({ reason: "unauthorized" });

/**
 * The task object's side of the dev box callback, after the Worker verified the capability.
 * Every state change runs under the object's gate; provider checks and credential minting run
 * outside it. Replies are encoded here, so they cross the object boundary as plain values.
 */
const make = Effect.gen(function* () {
  const durable = yield* Durable.Service;
  const alarm = yield* Alarm.Service;
  const server = yield* Server.Service;
  const commands = yield* Commands.Service;
  const tokens = yield* Tokens.Service;

  const gate = durable.gate;

  const assignment = (capability: Enrollment) => gate(server.assignment(capability));

  const enroll = Effect.fn("Endpoint.enroll")(function* (
    capability: Enrollment,
    request: Protocol.EnrollmentRequest,
  ) {
    let grant = yield* gate(server.replay(capability, request));

    if (!grant) {
      const current = yield* gate(server.context(capability));
      const verified = yield* server.verify(capability, request, current);

      grant = yield* gate(
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;

          yield* alarm.arm(now + 1);
          const accepted = yield* server.enroll(capability, verified, now);

          yield* alarm.recompute;

          return accepted;
        }),
      );
    }

    const reply = yield* server.reply(capability, request, grant, yield* Clock.currentTimeMillis);

    return yield* Schema.encodeEffect(Protocol.EnrollmentReply)(reply);
  });

  const ready = Effect.fn("Endpoint.ready")(function* (
    capability: Readiness,
    request: Protocol.ReadinessRequest,
  ) {
    const current = yield* gate(server.context(capability));

    yield* server.verifyReadiness(capability, current);

    return yield* gate(
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;

        yield* alarm.arm(now + 1);
        const reply = yield* server.accept(capability, request, now);

        yield* alarm.advance(now);
        yield* alarm.recompute;

        return reply;
      }),
    );
  });

  /** A claimed command's credential, minted outside the gate; none fails the command. */
  const credential = (spec: Protocol.RuntimeCommand["spec"]) =>
    spec.kind === "specialist"
      ? // Refresh first if the login would expire before the round's deadline.
        tokens.agentLogin(spec.timeoutMs + 10 * 60_000)
      : spec.kind === "checkout" || spec.kind === "push"
        ? tokens.repository(spec.repository, spec.kind)
        : null;

  const poll = Effect.fn("Endpoint.poll")(function* (
    capability: Readiness,
    request: Protocol.PollRequest,
  ) {
    // Wait outside the gate; each attempt is one short claim inside it.
    const deadline = (yield* Clock.currentTimeMillis) + request.waitMs;

    while (true) {
      const reply = yield* gate(
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const reply = yield* server.poll(capability, now);

          // A command now runs on the box; the alarm holds it awake at once.
          if (reply.command !== null) yield* alarm.arm(now + 1);

          return reply;
        }),
      );

      if (reply.command !== null) {
        const command = reply.command;
        const minting = credential(command.spec);
        const token = minting === null ? null : yield* minting;

        if (token !== null && token._tag === "None") {
          yield* gate(
            Effect.gen(function* () {
              const now = yield* Clock.currentTimeMillis;

              yield* commands.fail(
                command.id,
                command.spec.kind === "specialist"
                  ? "agent-credential-unavailable"
                  : "github-credential-unavailable",
                now,
              );

              yield* alarm.advance(now);
              yield* alarm.recompute;
            }),
          );

          return yield* Schema.encodeEffect(Protocol.PollReply)({ command: null });
        }

        return yield* Schema.encodeEffect(Protocol.PollReply)({
          command: { id: command.id, spec: command.spec, credential: token?.value ?? null },
        });
      }

      if ((yield* Clock.currentTimeMillis) >= deadline)
        return yield* Schema.encodeEffect(Protocol.PollReply)({ command: null });

      yield* Effect.sleep("1 second");
    }
  });

  const observe = (capability: Readiness, request: Protocol.ObserveRequest) =>
    gate(
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;

        yield* alarm.arm(now + 1);
        const reply = yield* server.observe(capability, request, now);

        yield* alarm.advance(now);
        yield* alarm.recompute;

        return reply;
      }),
    );

  const login = Effect.fn("Endpoint.login")(function* (capability: Readiness) {
    yield* gate(
      Effect.gen(function* () {
        yield* server.authorize(capability, yield* Clock.currentTimeMillis);
      }),
    );

    // Fetched outside the gate, returned once, never persisted by this object.
    const github = yield* tokens.githubLogin(60 * 60_000);

    return yield* Schema.encodeEffect(Protocol.LoginReply)({
      github:
        github === null
          ? null
          : {
              token: github.access,
              expiresAt: github.expiresAt,
              login: github.login,
              name: github.name,
              email: github.email,
            },
    });
  });

  const dispatch = (
    capability: Auth.Capability,
    request: Protocol.Request,
  ): Effect.Effect<unknown, { readonly _tag: string }> => {
    if (capability._tag === "Enrollment") {
      if (request._tag === "Assignment") return assignment(capability);
      if (request._tag === "Enroll") return enroll(capability, request.request);
    } else {
      if (request._tag === "Ready") return ready(capability, request.request);
      if (request._tag === "Poll") return poll(capability, request.request);
      if (request._tag === "Observe") return observe(capability, request.request);
      if (request._tag === "Login") return login(capability);
    }

    return Effect.fail(unauthorized());
  };

  /** One verified call; a refusal is a reply, which the Worker maps to its status. */
  const call = (
    capability: Auth.Capability,
    request: Protocol.Request,
  ): Effect.Effect<Protocol.RpcReply> =>
    dispatch(capability, request).pipe(
      Effect.map((value): Protocol.RpcReply => ({ ok: true, value })),
      Effect.catch((error) =>
        Effect.succeed<Protocol.RpcReply>({
          ok: false,
          reason: Schema.is(Failure)(error) ? error.reason : "unavailable",
        }),
      ),
    );

  return { call };
});

export interface Interface extends Effect.Success<typeof make> {}

export class Service extends Context.Service<Service, Interface>()(
  "@notus/control/runtime/Endpoint",
) {}

export const layer = Layer.effect(Service, make);

export * as Endpoint from "./endpoint";

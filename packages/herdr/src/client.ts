import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Crypto from "effect/Crypto";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { Failure } from "./errors";
import * as Socket from "./socket";
import { Ping, Snapshot, protocol, version, type Options } from "./types";

export interface Interface {
  readonly ping: Effect.Effect<Ping, Failure>;
  readonly snapshot: Effect.Effect<Snapshot, Failure>;
}
export class Service extends Context.Service<Service, Interface>()("@notus/herdr/Client") {}

const Envelope = Schema.Struct({
  id: Schema.String,
  result: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(Schema.Struct({ code: Schema.String, message: Schema.String })),
});
const Request = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.String,
    method: Schema.Literals(["ping", "session.snapshot"]),
    params: Schema.Struct({}),
  }),
);
const SnapshotResult = Schema.Struct({
  type: Schema.Literal("session_snapshot"),
  snapshot: Snapshot,
});

export const layerNoDeps = (options: Options) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const socket = yield* Socket.Service;
      const crypto = yield* Crypto.Crypto;
      const request = Effect.fn("Herdr.Client.request")(function* (
        method: "ping" | "session.snapshot",
      ) {
        const id = yield* crypto.randomUUIDv4().pipe(Effect.orDie);
        const encoded = yield* Schema.encodeEffect(Request)({ id, method, params: {} }).pipe(
          Effect.mapError(() => new Failure({ reason: "response" })),
        );
        const line = yield* socket.exchange(options.socketPath, encoded);
        const envelope = yield* Schema.decodeEffect(Schema.fromJsonString(Envelope))(line).pipe(
          Effect.mapError(() => new Failure({ reason: "response" })),
        );
        const hasResult = "result" in envelope;
        const hasError = "error" in envelope;
        if (envelope.id !== id || hasResult === hasError) {
          return yield* new Failure({ reason: "response" });
        }
        if (envelope.error !== undefined) return yield* new Failure({ reason: "remote" });
        return envelope.result;
      });
      const ping = Effect.gen(function* () {
        const result = yield* request("ping");
        const pong = yield* Schema.decodeUnknownEffect(Ping)(result).pipe(
          Effect.mapError(() => new Failure({ reason: "response" })),
        );
        if (pong.version !== version || pong.protocol !== protocol)
          return yield* new Failure({ reason: "incompatible" });
        return pong;
      }).pipe(Effect.withSpan("Herdr.Client.ping"));
      const snapshot = Effect.gen(function* () {
        // Fresh compatibility observation, never a process-global cached ping.
        yield* ping;
        const result = yield* request("session.snapshot");
        const { snapshot } = yield* Schema.decodeUnknownEffect(SnapshotResult)(result).pipe(
          Effect.mapError(() => new Failure({ reason: "response" })),
        );
        if (snapshot.version !== version || snapshot.protocol !== protocol)
          return yield* new Failure({ reason: "incompatible" });
        return snapshot;
      }).pipe(Effect.withSpan("Herdr.Client.snapshot"));
      return Service.of({ ping, snapshot });
    }),
  );

// Host transport remains a genuine explicit runtime requirement.
export const layer = layerNoDeps;
export * as Client from "./client";

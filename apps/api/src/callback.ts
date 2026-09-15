import * as Auth from "@notus/control/runtime/auth";
import { Failure } from "@notus/control/runtime/errors";
import * as Protocol from "@notus/control/runtime/protocol";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

const statuses = { invalid: 400, unauthorized: 403, pending: 425, conflict: 409, unavailable: 503 };
const invalid = () => new Failure({ reason: "invalid" });

export const handler = <E, R>(
  forward: (
    capability: Auth.Capability,
    request: Protocol.Request,
  ) => Effect.Effect<Protocol.RpcReply, E, R>,
) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = new URL(request.url, "https://notus.invalid");
    if (
      request.method !== "POST" ||
      url.search ||
      ![
        "/runtime/assignment",
        "/runtime/enroll",
        "/runtime/ready",
        "/runtime/poll",
        "/runtime/observe",
        "/runtime/login",
      ].includes(url.pathname)
    )
      return HttpServerResponse.empty({ status: 404 });
    const header = request.headers.authorization ?? "";
    if (header.length > 6207 || !/^Bearer [a-zA-Z0-9_.-]+$/.test(header))
      return HttpServerResponse.empty({ status: 401 });
    const authentication = yield* Auth.Service;
    const capability = yield* authentication.verify(
      Redacted.make(header.slice(7)),
      yield* Clock.currentTimeMillis,
    );
    if (request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/json")
      return yield* invalid();
    let length = 0;
    const chunks: Uint8Array[] = [];
    yield* request.stream.pipe(
      Stream.runForEach((chunk) =>
        Effect.gen(function* () {
          length += chunk.byteLength;
          if (length > 256 * 1024) return yield* invalid();
          chunks.push(chunk);
        }),
      ),
    );
    const text = yield* Effect.try({
      try: () => {
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      },
      catch: invalid,
    });
    let command: Protocol.Request;
    if (url.pathname === "/runtime/assignment") {
      yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Never)))(
        text,
        {
          onExcessProperty: "error",
        },
      ).pipe(Effect.mapError(invalid));
      command = Protocol.Request.cases.Assignment.make({});
    } else if (url.pathname === "/runtime/enroll") {
      const body = yield* Schema.decodeEffect(Schema.fromJsonString(Protocol.EnrollmentRequest))(
        text,
        { onExcessProperty: "error" },
      ).pipe(Effect.mapError(invalid));
      command = Protocol.Request.cases.Enroll.make({ request: body });
    } else if (url.pathname === "/runtime/poll") {
      const body = yield* Schema.decodeEffect(Schema.fromJsonString(Protocol.PollRequest))(text, {
        onExcessProperty: "error",
      }).pipe(Effect.mapError(invalid));
      command = Protocol.Request.cases.Poll.make({ request: body });
    } else if (url.pathname === "/runtime/observe") {
      const body = yield* Schema.decodeEffect(Schema.fromJsonString(Protocol.ObserveRequest))(
        text,
        { onExcessProperty: "error" },
      ).pipe(Effect.mapError(invalid));
      command = Protocol.Request.cases.Observe.make({ request: body });
    } else if (url.pathname === "/runtime/login") {
      yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Never)))(
        text,
        { onExcessProperty: "error" },
      ).pipe(Effect.mapError(invalid));
      command = Protocol.Request.cases.Login.make({});
    } else {
      const body = yield* Schema.decodeEffect(Schema.fromJsonString(Protocol.ReadinessRequest))(
        text,
        { onExcessProperty: "error" },
      ).pipe(Effect.mapError(invalid));
      command = Protocol.Request.cases.Ready.make({ request: body });
    }
    const runtimeBound =
      command._tag === "Ready" ||
      command._tag === "Poll" ||
      command._tag === "Observe" ||
      command._tag === "Login";
    if (runtimeBound !== (capability._tag === "Readiness"))
      return HttpServerResponse.empty({ status: 403 });
    const result = yield* forward(capability, command);
    if (!result.ok) return HttpServerResponse.empty({ status: statuses[result.reason] });
    return yield* HttpServerResponse.json(result.value, {
      headers: { "cache-control": "no-store" },
    });
  }).pipe(
    Effect.timeoutOrElse({
      duration: "25 seconds",
      orElse: () => Effect.succeed(HttpServerResponse.empty({ status: 503 })),
    }),
    Effect.catch((error) =>
      Effect.succeed(
        HttpServerResponse.empty({
          status: Schema.is(Auth.Failure)(error)
            ? 401
            : Schema.is(Failure)(error)
              ? statuses[error.reason]
              : 503,
        }),
      ),
    ),
  );

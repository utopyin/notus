import { createConnection } from "node:net";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Failure } from "./errors";
import * as Socket from "./socket";

// Bun's node:net implementation. Import and provide this host explicitly.
export const layer = Layer.sync(Socket.Service, () => {
  const exchange = Effect.fn("Herdr.Socket.exchange")((path: string, request: string) =>
    Effect.callback<string, Failure>((resume) => {
      let bytes = Buffer.alloc(0);
      let settled = false;
      let socket: ReturnType<typeof createConnection>;
      try {
        socket = createConnection({ path });
      } catch {
        resume(Effect.fail(new Failure({ reason: "connect" })));
        return;
      }
      const finish = (result: Effect.Effect<string, Failure>) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resume(result);
      };
      socket.once("connect", () => socket.write(request + "\n"));
      socket.on("data", (chunk: Buffer) => {
        // Hard cap includes coalesced frames, not only unterminated input.
        if (bytes.length + chunk.length > 1024 * 1024) {
          finish(Effect.fail(new Failure({ reason: "frame" })));
          return;
        }
        bytes = Buffer.concat([bytes, chunk]);
        const newline = bytes.indexOf(10);
        if (newline === -1) return;
        if (newline === 0 || newline !== bytes.length - 1) {
          finish(Effect.fail(new Failure({ reason: "frame" })));
          return;
        }
        try {
          finish(
            Effect.succeed(
              new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, newline)),
            ),
          );
        } catch {
          finish(Effect.fail(new Failure({ reason: "frame" })));
        }
      });
      socket.once("error", () => finish(Effect.fail(new Failure({ reason: "connect" }))));
      socket.once("end", () => finish(Effect.fail(new Failure({ reason: "eof" }))));
      socket.once("close", () => finish(Effect.fail(new Failure({ reason: "eof" }))));
      return Effect.sync(() => {
        settled = true;
        socket.destroy();
      });
    }).pipe(
      Effect.timeoutOrElse({
        duration: "2 seconds",
        orElse: () => Effect.fail(new Failure({ reason: "timeout" })),
      }),
    ),
  );
  return Socket.Service.of({ exchange });
});

export * as BunSocket from "./bun";

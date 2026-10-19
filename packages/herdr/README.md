# Herdr readiness client

`@notus/herdr` implements only native JSONL `ping` and `session.snapshot` over Unix sockets. It does not depend on `@herdr/sdk` or import `repos/`.

```ts
import { Client } from "@notus/herdr/client";
import { BunSocket } from "@notus/herdr/bun";
import * as BunCrypto from "@effect/platform-bun/BunCrypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

const client = Client.layer({ socketPath: "/owned/herdr.sock" }).pipe(
  Layer.provide(BunSocket.layer),
  Layer.provide(BunCrypto.layer),
);
const observation = Client.Service.use((herdr) => herdr.snapshot).pipe(Effect.provide(client));
```

Build that graph once per runtime lifetime. `Client.layerNoDeps(options)` and `Client.layer(options)` leave the host transport and cryptography service explicit. `BunSocket.layer` supplies Bun's `node:net` implementation. No connection or provider work happens on import.

## Contract

- `ping` returns a decoded `Ping` only for version `0.9.0`, protocol `22`.
- `snapshot` performs a fresh ping, then returns the decoded `Snapshot` readiness projection. It also checks snapshot version/protocol. This is not the full vendor DTO: only topology identifiers survive; labels, paths, tokens, terminal content and native session references are discarded. It does not certify agent readiness or task authority.
- Each request uses a new connection, a matching request ID, one newline-terminated UTF-8 response and a two-second deadline. The receive buffer is capped at 1 MiB. Extra coalesced frames, malformed JSON, wrong IDs, remote errors, EOF before a complete frame and incompatible versions fail closed. Cancellation and timeout destroy the socket. There is no compatibility cache or automatic request retry.
- Failures expose only the fixed `Failure.reason` union from `./errors`; raw remote messages and payloads are not retained in errors.

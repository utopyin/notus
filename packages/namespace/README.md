# Namespace control

Maintained unary Connect JSON clients for the private Namespace DevBoxService and readonly ComputeService destruction proof. No SDK, Node transport, environment credential discovery, exec, SSH, model calls or resource work on import.

## Public interface

```ts
import { Config } from "@notus/namespace/config";
import { Namespace } from "@notus/namespace/service";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

const control = Namespace.layer.pipe(
  Layer.provide(
    Config.layer({
      credential: Redacted.make(hostCredential),
      timeoutMs: 90_000,
      // endpoint: trustedHostOverride,
    }),
  ),
);
```

`Namespace.Service` provides:

- `create({ name, config: RawJson }) -> Effect<Resource, ConfigError | ControlError>`
- `fetch({ id }) -> Effect<Resource, ControlError>`
- `validateRestricted(input: RestrictedInput) -> Effect<Configuration, ConfigError>`
- `trustedLaunch(input: TrustedLaunchInput) -> Effect<Resource, ConfigError | ControlError>`
- `recoverByName(name | { name, expectedId?, operationId? }) -> Effect<Recovery, ControlError>`
- `activate(resource)` / `stop(resource) -> Effect<Resource, ControlError>`
- `expire(resource) -> Effect<void, ControlError>`

`Namespace.layer` supplies Effect's fetch HttpClient. `layerNoDeps` leaves HttpClient and `Config.Service` explicit. A substituted client must honor the same no-redirect, no-retry and cancellation contract. `Resource`, `RawJson` and `Configuration` live in `/types`; failures live in `/errors`. IDs and names are ordinary strings.

## Readonly destruction proof

```ts
import { Instances } from "@notus/namespace/instances";

const instances = Instances.layer.pipe(
  Layer.provide(
    Config.layer({
      credential: Redacted.make(hostCredential),
      timeoutMs: 30_000,
      // computeEndpoint: trustedComputeOrigin,
    }),
  ),
);
```

`Instances.Service.destroyed(instanceId)` returns `{ instanceId, destroyedAt }` only when ComputeService `DescribeInstance` reports exactly that instance as `DESTROYED` with a valid timestamp. Every `InstancesError` means destruction is not proven. This is provider-reported destruction of one old VM; the caller still checks the old VM belonged to the resource before enrolling a replacement.

## Configuration

`Config.decode(raw)` validates native CreateRequest protobuf JSON and returns `{ raw }`; `Config.encode` revalidates and returns the same JSON. Persist the raw JSON, never a projection. Unknown nested fields pass through unchanged. `NOTUS_*` environment names and the `notus` session name are reserved. Use native `instanceShape`, which the deployed API requires:

```json
{
  "imageName": "your-workspace/image",
  "instanceShape": {
    "virtualCpu": 4,
    "memoryMegabytes": 8192,
    "machineArch": "amd64",
    "os": "linux"
  },
  "site": "iad"
}
```

## Trusted launch

Control launches task boxes through `trustedLaunch`, not `create`. The configuration must select one of the workspace's approved images by exact digest and passes a restrictive allowlist: no repository checkout, hooks, custom sessions, integrations, secret references or privilege. The provider adds `NOTUS_CONTROL_URL`, `NOTUS_BOOTSTRAP_TOKEN` and the `notus` session running `notus-devbox start`; none of these enter returned resources. The admin who approves an image vouches for its contents and registration metadata.

`recoverByName` fetches by name after a lost create and reports whether the stored operation purpose matches. It never creates or activates.

## Wire contract

Unary Connect JSON over HTTPS with bearer authentication; only trusted host configuration can override the endpoint. Each call has one timeout, a 1 MiB response cap, no redirects and no retries; an unknown mutation outcome needs reconciliation, not replay. Errors carry fixed labels and HTTP status only, never provider messages or credentials.

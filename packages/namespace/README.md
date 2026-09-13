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

`Instances.Service.destroyed(instanceId)` returns `Effect<DestroyedReceipt, InstancesError>`. The receipt in `/types` contains only `{ instanceId, destroyedAt }`. It requires HTTP 200 JSON with the exact requested `metadata.instanceId`, literal `metadata.status: "DESTROYED"`, and a valid `metadata.destroyedAt`. Timestamp validation accepts calendar-valid RFC3339 in protobuf's range of years 0001 through 9999, explicit Z or numeric offset, and up to nine fractional digits. Leap-second notation is rejected because protobuf timestamps smear leap seconds. The timestamp string is preserved, not normalized. Numeric status values and field aliases are not accepted as proof.

The only request is unary POST `/namespace.cloud.compute.v1beta.ComputeService/DescribeInstance` with `{ instanceId }`, Connect JSON version 1 and the explicit `Config.Service` bearer credential. The default compute origin is `https://us.compute.namespaceapis.com`. Optional `computeEndpoint` is a separate trusted-host HTTPS origin, never derived from saved devbox JSON or the DevBoxService `endpoint`.

`Instances.layer` supplies Effect's Fetch HttpClient; `layerNoDeps` leaves HttpClient and Config explicit. Layer acquisition can fail with `ConfigError`. Neither import nor layer acquisition makes requests. Calls have no retries or fallback, manual redirects, omitted ambient credentials, a 1 MiB streamed response limit and one configured timeout covering the request and body processing. Scoped completion, timeout and interruption abort the request. Substitute transports must preserve these guarantees. DescribeInstance may return extended credentials, but the client discards all fields except the proof projection and never returns raw payloads.

Every `InstancesError` means destruction is not proven. Reasons are `invalidInput`, `transport`, `timeout`, `notFound`, `rejected`, `invalidResponse`, `identityMismatch`, `notDestroyed`, `missingDestroyedAt` and `invalidDestroyedAt`, with HTTP `status` only for non-200 responses. HTTP 404 is `notFound`, never success; 401 is `rejected`. DESTROYING, SUSPENDED and other non-DESTROYED statuses are `notDestroyed`. Missing identity/status or a JSON not-found error envelope is `invalidResponse`. Errors retain no provider messages, credentials, payloads or transport causes. Caller interruption remains interruption, not a receipt.

This is provider-reported destruction of one old VM, not hardware attestation or validation of current grants. Control/Domain must persist the prior VM association, fence the epoch and receipt, separately call `Namespace.Service.fetch` with the current Resource ID, verify its current instance, and confirm `instance/get` permission before enabling renewal. This client does not establish that the old VM belonged to the resource or authorize a replacement.

Contract inspected at SDK revision `3c5fe6b886611101af6a88331aaa097b9ae37264` in `compute_pb.ts`: DescribeInstanceRequest, DescribeInstanceResponse, InstanceMetadata and ComputeService.DescribeInstance. This strict receipt contract has offline mocked validation and one read-only live check against a historical destroyed instance using the dedicated automation token. It has not yet validated a real cold enrollment; see the [automation probe](../../docs/research/namespace.md#readiness-automation-probe-2026-09-13). Seventy temporary mock checks covered wire/auth headers, proof rejection, timestamp validation, HTTP failures, response limits, redirects, trusted origins, transport/body timeouts and interruption aborts. Package TypeScript, formatting and zero-warning lint checks passed; no test files are shipped. Historical `/tmp/notus-startup-C7HY46/*instance-expired.log` observations include destroyedAt but omit the actual identity/status evidence required here, so they do not validate this contract or current credential grants.

## Reusable configuration

`Config.decode(raw)` first makes an independent, immutable JSON snapshot, then validates native CreateRequest protobuf JSON and returns `{ raw }`. Serialization hooks, accessors, cycles and non-JSON object properties are rejected without invoking them. `Config.encode(configuration)` revalidates and returns that JSON without projecting, defaulting or normalizing it. Persist raw JSON, never the validation projection. `RawJson` aliases Effect's `Schema.Json` type, equivalent to `typeof Schema.Json.Type` on the installed API.

Exactly one of `imageName` or `imageRef` is required. `machineSize` and `instanceShape` are exclusive, as are `repository` and `versionControl`. Environment entries use native `{ name, value }` or `{ name, fromSecretId }`, never both. Literal values are not secret storage; use provider secret references for secrets. Sessions use `{ name, command, emoji? }`. Duplicate environment/session names, case-insensitive `NOTUS_*` names and the reserved `notus` session name are rejected.

The supported contract uses canonical camelCase keys, decimal int64 strings or safe integer numbers, numeric int32 fields, protobuf duration strings and known enum values. Omit unset known fields rather than passing null. Native shape, storage, features, access, repository, sessions, Tailscale, privilege, retention and network-policy fields are validated in `src/wire.ts`. Unknown nested JSON survives validation and is sent unchanged; unknown top-level JSON survives storage but blocks creation until supported. Known snake_case aliases are rejected to prevent validation bypass.

Saved `name`, `activate`, activation experiments, templates/blueprints, fork requests, hooks, bootstrap credentials and model integrations are unsupported. Caller-owned unique names are supplied separately; Create always sends `activate: false`. This is direct image creation, not a shared blueprint or generic CPU/memory model. Runtime bootstrap credentials must never enter reusable config. The codec cannot identify arbitrary secret values hidden in free-form strings. Treat config and image startup commands as trusted workspace configuration, not an execution sandbox.

The live deployment tested on 2026-09-13 rejected `machineSize` with `instance shape is missing`. Use native `instanceShape` there:

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

This is provider configuration, not a shared Notus machine model. Source-level schema coverage does not prove that a deployed private API supports every field.

## Restricted no-model launch

Control must use `trustedLaunch`, not generic `create`, for this experiment. The generic codec and create behavior remain available unchanged. `Namespace.validateRestricted` is also exported as a standalone, dependency-free effect. Validation makes no HTTP, image inspection or credential calls and returns only the original immutable configuration snapshot.

`RestrictedInput` contains `config: RawJson`, `approvedImageRef: string` and `approvedImageSource: "audited-no-checkout-or-startup"`. The latter is a required trusted-host assertion, never a field extracted from user JSON. The host must establish that the approved image and Namespace metadata have no checkout, custom sessions, hooks, model integrations, secret references, capability/security overrides or unsafe environment/startup behavior. Unknown image provenance must block launch. This package cannot establish those facts from a digest or inspect image contents offline.

The API requires `NOTUS_IMAGE_AUDIT=audited-no-checkout-or-startup` alongside `NOTUS_APPROVED_IMAGE_REF`; it does not invent the assertion from the digest. Before setting it, inspect the executable image, read back the exact registered image with `DescribeImage`, and inspect its effective `BlueprintSpec` with `InspectImage`. Record the image ID/version/digest and metadata receipt. Reject unreviewed `onCreate`, `onStartup`, sessions, environment, volumes and security settings. Ordinary image-owned `HOME`/`PATH` defaults must match the inspected image. Registration metadata is mutable independently of the OCI digest: only trusted operators may change it, and any change requires withdrawal and renewed approval. This is an external operational trust boundary, not runtime attestation or automatic metadata verification.

`TrustedLaunchInput` additionally requires `name`, a durable stable `operationId`, and `bootstrap: { controlUrl: string, credential: Redacted<string> }`. The URL must be a trusted HTTPS origin/path without userinfo, query or fragment. Callback redirect and enrollment policy belongs to the callback owner. Only the provider boundary unwraps the credential, after validating user config. It adds exactly `NOTUS_CONTROL_URL` and `NOTUS_BOOTSTRAP_TOKEN`, and a top-level `notus` session with the fixed command `exec /usr/local/bin/notus-devbox start`. These values never enter returned resources or reusable snapshots.

Restricted config must select the exact approved OCI `imageRef`, using an explicit registry/repository and lowercase SHA-256 digest. Mutable `imageName` and tags are rejected. The accepted native subset allows machineSize or instanceShape, site, new volume sizes, retention, busy duration and network policy. Instance shape permits positive CPU/memory values, amd64/arm64 and Linux; selectors and reused volume names are unsupported. It does not require a shared machine configuration or translate one.

Unknown keys are rejected recursively. Checkout/repository settings, fork/template inputs, hooks, custom sessions, model/other integrations, secret references, privilege escalation, capability/security overrides and nonempty feature lists are rejected, not discarded. Only empty `versionControl`, integrations and sessions, private access, false privilege and empty features are compatible with the launch policy. Caller `documentedPurpose` is rejected because the provider owns operation provenance.

Literal environment values survive unchanged for `LANG`, `LC_ALL`, `LC_CTYPE`, `TZ`, `TERM`, `COLORTERM`, `NO_COLOR` and `PROJECT_VARIANT`, with bounded printable ASCII values. Other variables are unsupported, including shell/loader/runtime/proxy/model overrides. All original reserved-name guards still apply. Adding another harmless environment variable requires an explicit policy change.

The pinned CreateRequest has **no `noVCS` field**. It documents `versionControl` as used as-is. Restricted Create requests `{ versionControl: {}, accessMode: "USER_PRIVATE", privileged: false, integrations: {}, privateFeatures: [], enabledFeatures: [], features: { enabled: [] } }` and `activate: false`. Features explicitly disables inherited defaults according to the native field documentation; privilege overrides the image default. Empty integrations and VCS are requests, not independently established server isolation guarantees. Image metadata registration has lost sessions and `setupDockerClient: false` in prior observations; top-level Create sessions worked. Neither those observations nor Namespace-injected registry credentials prove isolation. Activation remains a separate operation after the caller durably stores resource identity.

`recoverByName` sends native Fetch with `name`, not ID, and checks the exact returned name and optional expected ID. It never creates or activates. `Recovery` contains `resource` and `evidence`: `matchingPurpose`, `purposeMismatch`, or `insufficientEvidence`. The provider writes `notus:restricted:v1:<operationId>` into documented Create `documentedPurpose` and compares Fetch's raw devbox `documentedPurpose`; it does not return the raw description. Missing purpose or omitted operation ID yields insufficient evidence. Fetch failures, including not-found, remain errors and never authorize a second Create.

A matching mutable description is not attestation, an idempotency key or proof of exactly-once creation. The caller must retain durable operation/name evidence, fence results and decide whether adoption is justified. Name reuse remains unsafe. Resource now optionally includes the opaque native `instanceId`; existing ID-based Fetch and resource fixtures remain valid. Fetch readiness stays unknown even when an instance is observed. These observations do not prove supervisor readiness or continuous health.

## Wire and safety contract

Requests POST JSON with `Connect-Protocol-Version: 1` and bearer authentication to `https://private-api.iad.namespaceapis.com/namespace.private.devbox.v1beta.DevBoxService/{Method}`. Only trusted host configuration can override the HTTPS origin; saved devbox JSON cannot select the endpoint. Redirects and ambient fetch credentials are disabled.

Each RPC has one explicit timeout covering request, response-body consumption and JSON parsing. Response bodies are capped at 1 MiB; restricted Create also caps its encoded request at 1 MiB. HTTP error bodies are not read; error values contain only fixed operation/reason/outcome labels and optional HTTP status, not provider messages, credentials or request/response payloads. Scoped requests abort on completion, interruption and timeout. There are no retries, including Fetch. An unknown mutation outcome requires reconciliation, not automatic replay. Interruption also does not roll back a mutation.

Fetch uses ID lookup, `returnActivatedInstance: true` and `includeSshCredentials: false`. Mutations first fetch and verify the stored ID/name. Activate also sends the ID, requests readiness and excludes SSH credentials. Stop and Expire are name-only in the pinned protocol; verification cannot eliminate a concurrent rename/name-reuse race. Hosts must avoid name reuse. Expire checks that its returned devboxes identify exactly the requested resource.

Resources expose only ID, name, observed state/readiness and image identity when returned. Create/Stop acknowledgements imply stopped; Fetch uses the returned backing instance ID to distinguish running from stopped. Activate readiness is provider readiness, not successful checkout, supervisor startup or model readiness. No credentials or full devbox specs are returned.

## Evidence and limits

Contract inspected at Namespace SDK commit `a72324a20c4c6402960a2fd4ed6382624691b8d9`: generated `devbox_pb.ts` request/response messages, `compute_pb.ts` InstanceShape and `labels_pb.ts` Label. These focused schemas are provider-owned code, not copied generated files. See [integration evidence](../../docs/research/namespace.md) for API findings. The published SDK 1.0 is not a dependency and lacks fields used here.

Local checks used installed Effect `4.0.0-rc.112`: package TypeScript and lint checks, browser-target import bundle, and temporary mocked-fetch checks for lossless JSON, validation, wire bodies, identity mismatch, redirects, size limits, sanitized errors, no retries, full-body timeout and interruption abort. No test files are shipped. Later live checks exercised Create, Fetch and Expire from local workerd against the authorized Namespace workspace. That initial Activate timed out. A later image-user fix enabled real Namespace Herdr readiness through a private native-API probe. The probe supplied the reserved startup session directly at Create because image registration dropped it. This package still rejects that name in user configuration. Its separate restricted launch method now injects trusted startup settings, but has only offline mocked validation; do not mistake the probe for completed production provisioning. See [devbox results](../../docs/research/devbox-results.md) for the successful startup, stop/start failure and authority boundary. No Cloudflare integration was deployed.

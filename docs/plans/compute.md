# Compute plan

Agreed direction: provider capabilities, per-workspace connections and templates, no deployment audit, no built-in template. Each increment still needs its own go-ahead before live provider resources are touched.

A devbox provider is whatever creates, wakes and ends the machine a task works on. Before this plan that was Namespace, and nothing else could be. `Devbox.Service` imported `@notus/namespace` directly, rejected any other provider key, and needed a `Devbox.NamespacePolicy` to run at all. The API built one Namespace client from `NAMESPACE_CONTROL_TOKEN`, so a deployment served one Namespace account for every workspace. Approved images were an OCI list in `NOTUS_APPROVED_IMAGE_REF` plus a workspace table keyed by the literal `"namespace"`. The dashboard always rendered the Namespace form.

This plan gives devbox providers the shape the [platforms plan](platforms.md) gave sources: a vocabulary package that says what providers exist, what each can do and how it is presented; one adapter per provider; and a registry that hosts yield without ever branching on a provider's name. The first increment changes no behavior. Namespace keeps running through the same native calls, but only behind the port, and its credential and templates move from Worker environment into the workspace. Boat is then a second adapter, not a refactor.

"Compute" rather than "provider" because the [product vocabulary](../../CONTEXT.md#vocabulary) already gives "provider connection" to model logins.

## Vocabulary: `@notus/compute`

Depends on `effect` only, so the dashboard imports descriptors without pulling a provider client.

| Module            | Owns                                                                                                                                                                                                                                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider.ts`     | `Provider = Schema.Literals(["namespace"])`. Append-only. Every column, key and form derives from it.                                                                                                                                                                                                                         |
| `capabilities.ts` | `Capability` literals, `Capabilities.ensure`, `CapabilityNotSupportedError`, with the same rules as `@notus/platform/capabilities`.                                                                                                                                                                                           |
| `descriptor.ts`   | `ProviderDescriptor`, pure data: name, icon key, baseline `Capabilities`, `template` (what a launch template is called and how its reference is written). `PROVIDER_DESCRIPTORS` is total over `Provider`.                                                                                                                    |
| `adapter.ts`      | `ProviderAdapter { provider, descriptor, configuration, forWorkspace(workspaceId) → DevboxPort }`. `configuration` validates native JSON, template references and a submitted account without a credential or a provider call, so the API checks a save before anything is connected, and says which template is the default. |
| `credentials.ts`  | `ComputeCredentials { get }` over opaque JSON, host-trusted. Only the adapter decodes it, as with `InstallationCredentials`. Writes are the workspace domain's, gated on admin.                                                                                                                                               |
| `templates.ts`    | `Templates { approved(workspaceId, provider) → { refs, default } }`, host-trusted. A failed read yields none.                                                                                                                                                                                                                 |
| `errors.ts`       | `ProviderNotRegisteredError`, `DuplicateProviderRegistrationError`, `ConnectionError` (`missing \| invalid \| storage`, nothing sent), `ConfigurationError`, and a neutral `ComputeError` that keeps the existing outcome classification: `notSent \| rejected \| unknown`, plus `notFound`.                                  |

### Capabilities

Each one names a behavior Notus decides on. A provider's own concepts (blueprints, shapes, sites, sandbox sizes) stay in its native configuration.

| Capability          | Meaning                                                                                       | Namespace       | Boat (from docs, unvalidated) |
| ------------------- | --------------------------------------------------------------------------------------------- | --------------- | ----------------------------- |
| `sleep:auto`        | The provider stops an idle box itself. Notus does nothing during waits.                       | yes, untested   | no (fixed auto-stop deadline) |
| `sleep:request`     | Notus can stop a box and keep its disk for a later wake.                                      | yes (Stop)      | yes (stop and snapshot)       |
| `wake:request`      | Notus can start a stopped box again on the same resource.                                     | yes (Activate)  | yes (resume)                  |
| `busy:signal`       | The box can tell the provider it is busy, so a running command is never stopped as idle.      | yes (marker)    | yes (extend)                  |
| `replacement:proof` | The provider proves the previous machine ended before a new one enrolls on the same resource. | yes (instances) | to check                      |

Namespace's auto-sleep is still untested ([results](../research/devbox-results.md)), so its descriptor claims only what the code relies on today and the claim is recorded in research before it is used.

Callers decide from the descriptor, never from the provider name:

- **Human wait begins.** `sleep:auto` → nothing. `sleep:request` → the task host asks the port to stop once the box is idle. Neither → the box stays up, which the provider's limits govern.
- **Operator needs a box that stopped polling** (`entrypoints/control/src/operator.ts:233-237`). `wake:request` → `requestWake` as now. Otherwise → the provisioning state reports the box lost and the operator is told it has none.
- **Re-enrollment on a new machine.** `replacement:proof` → today's check. Otherwise → re-enrollment is refused. That path is decided in the Boat increment.

An adapter still enforces its own capabilities with `ensure` before any I/O. The static check is a prefilter.

### The port

```ts
interface DevboxPort {
  readonly launch: (input: Launch) => Effect<Resource, ComputeError>; // bootstrap env + start command, idempotent on operationId
  readonly recover: (name: string, operationId: string) => Effect<Recovery, ComputeError>;
  readonly fetch: (resource: ResourceRef) => Effect<Observation, ComputeError>;
  readonly wake: (
    resource: ResourceRef,
  ) => Effect<Observation, ComputeError | CapabilityNotSupportedError>;
  readonly sleep: (
    resource: ResourceRef,
  ) => Effect<Observation, ComputeError | CapabilityNotSupportedError>;
  readonly end: (resource: ResourceRef) => Effect<void, ComputeError>;
  readonly proveReplacement: (
    previous: Enrollment,
    current: ResourceRef,
  ) => Effect<Termination, ComputeError | CapabilityNotSupportedError>;
}
```

`Observation` is `{ resource, state: "running" | "stopped" | "ended" | "unknown", machineId }`. The translation into `ProvisioningResult` that `devbox.ts` does today stays in executions, so the provisioning state machine stays the same. The Namespace error mapping (`Fetch` 404, `notSent`, `ConfigError`) moves into the adapter.

`Launch` carries the bootstrap contract that `trustedLaunch` implements only implicitly today. Every provider must deliver `NOTUS_CONTROL_URL` and `NOTUS_BOOTSTRAP_TOKEN` to the box and run `/usr/local/bin/notus-devbox start` as a process the provider restarts after a wake. How it does that (a Namespace session, a Boat setup file plus a systemd unit) is the adapter's concern.

## Domains

- `@notus/executions/providers` holds the registry: `Providers.Service { forProvider(provider) → ProviderScope, forWorkspace(workspaceId) → DevboxPort }`, built from `Providers.layer(Effect.all([namespace]))`. `forWorkspace` reads the workspace environment, its connection and its templates, then hands the adapter a ref. It lives beside `Devbox` instead of in a domain of its own, because executions is its only caller.
- `@notus/compute-namespace/adapter` assembles a `ProviderAdapter` over `@notus/namespace`. It is that package's only importer outside the app. `NamespacePolicy`, `validateRestricted` and `imageRefPattern` stop being imported by the API and dashboard.
- `Devbox.Service` keeps its interface. `perform` asks `Providers.forWorkspace(claim.environment.workspaceId)` and translates the observation. The `provider !== "namespace"` check becomes the registry's `ProviderNotRegisteredError`, which maps to `Rejected`.

## Data: everything per workspace

Nothing about a provider account stays in Worker configuration. Removed: `NAMESPACE_CONTROL_TOKEN`, `NOTUS_APPROVED_IMAGE_REF`, `NOTUS_IMAGE_AUDIT`, `providerConfig`, `approvedImageConfig`. The control URL and the bootstrap signing key stay deployment configuration, because they are Notus's own authority, not the provider's.

- `workspace_compute_connections (key, workspaceId, provider, label, connectedBy, connectedAt, credential)`, keyed on `(workspaceId, provider)`. The credential is sealed with `Sealed.Service`, as on `workspace_installations`: it is written by admins, never read back or projected, and only the adapter decodes it. A Namespace connection holds the token alone; the endpoints stay the client's defaults, so an admin cannot point the deployment at another host. A tenant outside the default region needs those endpoints as a later, validated field.
- `workspace_images` becomes `workspace_templates`, with the same columns plus `isDefault`, at most one per `(workspaceId, provider)` by a partial unique index. `ref` stays opaque. The adapter's `configuration.validateTemplate` checks it: a Namespace image digest, a Boat named snapshot. The migration renames the table and keeps the rows.
- `workspace_environments` is unchanged: provider key plus opaque JSON. Switching provider means saving a new revision with another key.

The deployment's audited list goes away. A template runs because a workspace admin added it, which is already true for workspace images. Notus ships no built-in template. A workspace may mark one template as its default, and the setting is optional:

- The adapter may infer a default (`configuration.defaultOf`). Namespace infers the workspace's only image when there is exactly one. The dashboard shows that inference; it is never saved for the admin.
- Otherwise an admin picks one, or none. Without a default, a launch uses whatever the native configuration selects, and the adapter refuses it if that is not one of the workspace's templates.

## API and dashboard

- Environment, template and connection endpoints take the provider from the request and validate through `Providers.forProvider(provider).configuration`. The `"namespace"` literals in `apps/api/src/api.ts` and `runtime.ts` go away.
- Admin-only connection endpoints: `dashboardConnectCompute` and `dashboardDisconnectCompute`. The environment view carries the connection's status (provider, label, who, when) and never the credential. `dashboardSetDefaultImage` marks or clears the default.
- The Devbox page offers the providers the deployment registered, shows the connection state of the one in view, and selects the native form by provider key. `apps/dashboard/src/devbox/namespace/` stays as the Namespace kit. The template list takes its noun and placeholder from the descriptor.

## Box side

Every runtime command calls `/usr/local/libexec/notus/busy start|end <command id>` around its run, which the provider's template supplies. If the hook is missing, it does nothing; if it fails, the box logs `devbox.busy_signal_unavailable` and runs the command anyway. The Namespace hook (`apps/devbox/namespace/busy`) writes the marker under `/.namespace/tasks`, and the base image installs it, so that image keeps working. The Namespace-only `capabilities*.json` files moved under `apps/devbox/namespace/` with it. The base Dockerfile's `USER devbox`, which Namespace needs for its Docker socket setup, stays where it is until a second template needs a different user.

## Increments

1. **Vocabulary and adapter.** Implemented. `@notus/compute`, `@notus/compute-namespace`, `Providers` in executions, and `Devbox` over the port. `requestWake` checks `wake:request`. Lifecycle copy is provider-neutral. The deployment image list and its audit went away with it: a workspace launches only the images its admins added. API saves take the provider and validate through `apps/api/src/compute.ts`. The Namespace credential is still `NAMESPACE_CONTROL_TOKEN` until increment 2. Nothing asks a box to sleep yet, because the only provider sleeps by itself.
2. **Workspace connection and templates.** Implemented. `workspace_compute_connections` and `workspace_templates` (migration `compute_connections`), `Compute` and `Templates` in `@notus/workspaces`, and the Namespace adapter building its clients per workspace from the sealed token. `NAMESPACE_CONTROL_TOKEN` is gone; the task host needs only `NOTUS_CONTROL_URL` and its runtime keys. A workspace without a connection gets `ConnectionError`, which `Devbox` reports as `Rejected`. The Devbox page has an Account card (connect, replace, disconnect) and a default toggle on each image. The fixture workspace must be reconnected through the dashboard after deploying: no seed from environment.
3. **Dashboard.** Implemented. The Devbox page renders `ProviderPage` over a provider's `Kit` (`apps/dashboard/src/devbox/kit.ts`): its mark, native form and field helpers, how a template reference is shaped and shortened, and how a pasted secret becomes the account JSON. The account card, template list, save and history are shared. `KITS` is total over `Provider`, so a new provider does not compile without one. `dashboardEnvironment` takes an optional provider, falls back to the one the workspace runs on, and returns the deployment's registered providers; the page offers a choice only when there are several. A history revision of another provider shows as such and cannot be opened in this form.
4. **Box hook.** Implemented. The supervisor calls the hook instead of writing Namespace's marker itself, and the Namespace files live under `apps/devbox/namespace/`. The supervisor ships inside the image, so a published image keeps its own supervisor and marker until it is rebuilt; a rebuilt image carries both the new supervisor and the hook.
5. **Boat.** Research and a first live probe are recorded in [Boat](../research/boat.md): bootstrap must go through an environment file written by the setup script, because `env` does not reach systemd; resume takes about a second; the deadline stops a box mid-command; and no API field identifies the machine, so the instance id must come from the box (its boot id) under a protocol change still to be decided. Originally listed for research: bootstrap delivery, systemd restart after resume, stop and resume readiness, replacement semantics, idempotent create, and the 14-day snapshot expiry. Then `@notus/boat` (client) and `@notus/compute-boat` (adapter), with `Provider` widened to `["namespace", "boat"]`.

The product context's provider-specific requirements were made provider-neutral with increment 1.

## Validation

Frozen install, root typecheck, focused lint. Increment 1 replays the existing Namespace startup check against the port, with no new live resources unless separately authorized. Increment 2 was checked against SQLite with every D1 migration applied: an existing image row becomes a template; one default at most, moved and cleared; members cannot connect; the stored credential is sealed and opens for the task host; connect replaces and disconnect removes; the connection view never carries the credential; and the registry gives a port only to a connected workspace. No live Namespace call was made.

# Compute plan

Agreed direction: provider capabilities, per-workspace connections and templates, no deployment audit, no built-in template. Each increment still needs its own go-ahead before live provider resources are touched.

A devbox provider is whatever creates, wakes and ends the machine a task works on. Today that is Namespace, and nothing else could be. `Devbox.Service` imports `@notus/namespace` directly, rejects any other provider key, and needs a `Devbox.NamespacePolicy` to run at all. The API builds one Namespace client from `NAMESPACE_CONTROL_TOKEN`, so a deployment serves one Namespace account for every workspace. Approved images are an OCI list in `NOTUS_APPROVED_IMAGE_REF` plus a workspace table keyed by the literal `"namespace"`. The dashboard always renders the Namespace form.

This plan gives devbox providers the shape the [platforms plan](platforms.md) gave sources: a vocabulary package that says what providers exist, what each can do and how it is presented; one adapter per provider; and a registry that hosts yield without ever branching on a provider's name. The first increment changes no behavior. Namespace keeps running through the same native calls, but only behind the port, and its credential and templates move from Worker environment into the workspace. Boat is then a second adapter, not a refactor.

"Compute" rather than "provider" because the [product vocabulary](../../CONTEXT.md#vocabulary) already gives "provider connection" to model logins.

## Vocabulary: `@notus/compute`

Depends on `effect` only, so the dashboard imports descriptors without pulling a provider client.

| Module            | Owns                                                                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider.ts`     | `Provider = Schema.Literals(["namespace"])`. Append-only. Every column, key and form derives from it.                                                                                                                                 |
| `capabilities.ts` | `Capability` literals, `Capabilities.ensure`, `CapabilityNotSupportedError`, with the same rules as `@notus/platform/capabilities`.                                                                                                   |
| `descriptor.ts`   | `ProviderDescriptor`, pure data: name, icon key, baseline `Capabilities`, `template` (what a launch template is called and how its reference is written). `PROVIDER_DESCRIPTORS` is total over `Provider`.                            |
| `adapter.ts`      | `ProviderAdapter { provider, descriptor, configuration, forWorkspace(ref) → DevboxPort }`. `configuration` validates native JSON and template references without a credential, so the API checks a save before anything is connected. |
| `credentials.ts`  | `ComputeCredentials { get, put, remove }` over opaque JSON. Only the adapter decodes it, as with `InstallationCredentials`.                                                                                                           |
| `errors.ts`       | `ProviderNotRegisteredError`, `DuplicateProviderRegistrationError`, `ConnectionNotFound`, and a neutral `ComputeError` that keeps the existing outcome classification: `notSent \| rejected \| ambiguous`, plus `notFound`.           |

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

- `workspace_compute_connections (key, workspaceId, provider, label, connectedBy, connectedAt, credential)`, keyed on `(workspaceId, provider)`. The credential is sealed with `Sealed.Service`, as on `workspace_installations`: it is written by admins, never read back or projected, and only the adapter decodes it. A Namespace connection holds the token and, optionally, the trusted endpoints `Config` takes today.
- `workspace_images` becomes `workspace_templates`, with the same columns plus a nullable `default` flag, at most one per `(workspaceId, provider)`. `ref` stays opaque. The adapter's `configuration.validateTemplate` checks it: a Namespace image digest, a Boat named snapshot. The migration copies the existing rows.
- `workspace_environments` is unchanged: provider key plus opaque JSON. Switching provider means saving a new revision with another key.

The deployment's audited list goes away. A template runs because a workspace admin added it, which is already true for workspace images. Notus ships no built-in template. A workspace may mark one template as its default, and the setting is optional:

- The adapter may infer a default from the connected account (`configuration.inferDefault`, for example a Namespace image the native config already selects). The dashboard shows that inference; it is never saved for the admin.
- Otherwise an admin picks one, or none. Without a default, a launch uses whatever the native configuration selects, and the adapter refuses it if that is not one of the workspace's templates.

## API and dashboard

- Environment, template and connection endpoints take the provider from the request and validate through `Providers.forProvider(provider).configuration`. The `"namespace"` literals in `apps/api/src/api.ts` and `runtime.ts` go away.
- New admin-only connection endpoints: put and remove. They never return the credential.
- The Devbox page lists `PROVIDER_DESCRIPTORS` entries the deployment registered, shows the connection state for each, and selects the native form by provider key. `apps/dashboard/src/devbox/namespace/` stays as the Namespace form. The template list takes its noun and placeholder from the descriptor.

## Box side

The Namespace idle marker in `apps/devbox/src/commands.ts:230-237` becomes a call to `/usr/local/libexec/notus/busy start|end <command>`, which the provider's template supplies. If the hook is missing, it does nothing. The Namespace template ships the marker script, so the base image keeps working. The Namespace-only `capabilities*.json` files, the `USER devbox` workaround and the `nscr.io` default in `Dockerfile.dotfiles` move under `apps/devbox/namespace/`.

## Increments

1. **Vocabulary and adapter.** Implemented. `@notus/compute`, `@notus/compute-namespace`, `Providers` in executions, and `Devbox` over the port. `requestWake` checks `wake:request`. Lifecycle copy is provider-neutral. The deployment image list and its audit went away with it: a workspace launches only the images its admins added. API saves take the provider and validate through `apps/api/src/compute.ts`. The Namespace credential is still `NAMESPACE_CONTROL_TOKEN` until increment 2. Nothing asks a box to sleep yet, because the only provider sleeps by itself.
2. **Workspace connection and templates.** Migrations, the sealed credential and endpoints. The environment variables go away. The fixture workspace is reconnected through the dashboard: no seed from environment.
3. **Dashboard.** Provider list, connection card, per-provider form and template list.
4. **Box hook** and the move of the image's Namespace files.
5. **Boat.** `docs/research/boat.md` first: bootstrap delivery, systemd restart after resume, stop and resume readiness, replacement semantics, idempotent create, and the 14-day snapshot expiry. Then `@notus/boat` (client) and `@notus/compute-boat` (adapter), with `Provider` widened to `["namespace", "boat"]`.

The product context needs wording changes that are requirements, not implementation: "Namespace dev boxes" under selected technology, "Rely on Namespace auto-sleep during human waits", and Namespace's retention policy under retention. Each becomes provider-neutral and points at the capability. This is listed here for approval and not edited yet.

## Validation

Frozen install, root typecheck, focused lint. Increment 1 replays the existing Namespace startup check against the port, with no new live resources unless separately authorized. Increment 2 checks that a sealed credential round-trips, that it is never present in any API response, and that the image rows migrate.

# Sources plan

A source is where humans and Notus talk: a Slack thread, a pull request conversation. Today the [contract](../../packages/contracts/src/source.ts) is neutral but everything around it is not. `workspace_channels` stores Slack team and channel IDs and smuggles GitHub repositories through the same columns; ingress accepts one Slack channel and one GitHub installation named in the Worker's environment rather than what a workspace configured; the tasks `Sources` service is one object with `if (kind === "github")` inside; and the dashboard has a "Slack channels" page because that is the only shape the backend offers.

This plan turns the source into a contract with registered implementations, the way `@inbox/platform` describes messaging networks: one vocabulary package that names the platforms, what a platform can do, how it is presented and how it is connected; a domain whose modules implement that vocabulary for one platform each over the provider SDKs; a registry the hosts yield to reach an adapter without ever branching on its name. The tiers are the codebase plan's: a package knows nothing of Notus (`@notus/platform` is the contract, `@notus/slack` and `@notus/github` are SDKs), a domain is where product decisions live (`domains/sources` decides what a mention means and who may steer a pull request). Core code that pulls a platform identifier apart has reached past the seam.

## Vocabulary: `@notus/platform`

Replaces `@notus/contracts/source`. Depends on `effect` only, so the dashboard imports descriptors without pulling a provider client.

| Module            | Owns                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `platform.ts`     | `Platform = Schema.Literals(["slack", "github"])`. The single definition every enum, column and client derives from. Append-only.                                                                                                                                                                                                                                                     |
| `ids.ts`          | Branded opaque strings: `InstallationId` (a Slack team, a GitHub App installation), `PlatformId` (a channel, a repository, a thread, a message, a comment). Only the owning adapter parses or builds one. `InstallationRef { id, platform, installationId }` is what adapters receive.                                                                                                |
| `capabilities.ts` | `Capability` literals and `Capabilities.ensure`: `input:start`, `input:message`, `input:review`, `output:update`, `output:reply`, `output:react`, `scope:list`, `conversation:open`. An operation an adapter cannot perform fails `CapabilityNotSupportedError` before any I/O. Attachment flags (`receive`, `reply`, `updates`, `reaction`) narrow these per attachment.             |
| `descriptor.ts`   | `PlatformDescriptor`: pure data and pure functions. Name, icon key, accent, the scope noun ("channel", "repository"), `scopeLabel`, `conversationUrl`, the baseline `Capabilities`, and `install`: how a workspace connects an installation (`{ kind: "oauth" \| "app-install", url(state) }`). `PLATFORM_DESCRIPTORS` is total over `Platform`, so a missing one is a compile error. |
| `source.ts`       | `Source { platform, installationId, scope: PlatformId, conversation: PlatformId }`, `ReplyTarget { source, target: PlatformId }`, `Actor { platform, installationId, externalId }`, `Input`, `Reservation`. `scope` becomes explicit so authorization is a lookup, never a parse.                                                                                                     |
| `ingress.ts`      | `PlatformIngress { verify(request), normalize(installation, payload) → Normalized }` where `Normalized` is `{ type: "input", input } \| { type: "acknowledge", body } \| { type: "ignored" }`. Slack's URL challenge is an acknowledgement, not a special case in the host.                                                                                                           |
| `adapter.ts`      | `PlatformAdapter { platform, descriptor, ingress, forInstallation(ref) → InstallationSurfaces }` with `InstallationSurfaces { scopes: Scopes, conversations: Conversations, identity: Identity }`: list scopes the app can see; resolve reply and update handles for a target; describe an actor. Every handle is runtime-only; only `ReplyTarget` is persisted.                      |
| `registry.ts`     | `Platforms.Service { forPlatform(platform) → PlatformScope, forInstallation(installationId) → InstallationPort }`, built from `layerAdapters([slack, github])`. Duplicate registration and unregistered platform are typed failures. The raw adapter never escapes.                                                                                                                   |
| `errors.ts`       | `PlatformNotRegisteredError`, `DuplicatePlatformRegistrationError`, `InstallationNotFound`, `CapabilityNotSupportedError`, `IngressError`, `DeliveryError` with the existing `rate-limited \| rejected \| ambiguous` classification and `retryAfter`.                                                                                                                                 |
| `conformance/`    | One case list every adapter runs against its own fixtures: an unsupported capability fails before I/O; `normalize` ignores the app's own messages; a reply target round-trips through the registry; `scopes.list` returns only scopes the installation can act in; a throttled delivery carries `retryAfter`. Adding a case turns every adapter red at once.                          |

Platform-specific data that the neutral half cannot hold lives in a tagged pocket per platform (`SourcePlatformData`), never in extra columns: a Slack conversation carries `{ _tag: "slack", threadTs }`, a GitHub one `{ _tag: "github", number }`. A field moves into the neutral half when a second platform needs an equivalent.

## Adapters: `domains/sources`

`@notus/slack` and `@notus/github` stay SDKs (`service.ts`, `app.ts`, `webhooks.ts`: clients, verification, decoding), with nothing about Notus in them. `domains/sources` holds `slack.ts` and `github.ts`, each assembling a `PlatformAdapter` from its SDK: what counts as start intent, how a review comment is phrased for the operator, which marker claims a task, who may steer a pull request. The tasks domain's `sources.ts` and the control inbox's GitHub normalization move into those adapters; what remains in tasks is the neutral attachment and delivery logic, which asks `Platforms.forInstallation` for handles. The rule is the one the codebase plan already states: the provider package verifies and decodes, the adapter normalizes, the shared use case resolves identity and authorizes.

## Data

Two workspace-owned tables replace `workspace_channels`:

- `workspace_installations (id, workspaceId, platform, installationId, label, installedBy, installedAt)`, unique on `(platform, installationId)`: an installation belongs to one workspace.
- `workspace_sources (workspaceId, installationKey, scope, label)`: the channels and repositories a workspace listens in and works on.

`Access.authorizeSource` becomes one lookup on `(workspaceId, installation, scope)`. Ingress resolves the workspace from `(platform, installationId)` before normalizing, so the Worker's `SLACK_TEAM_ID`, `SLACK_CHANNEL_ID` and `GITHUB_APP_INSTALLATION_ID` stop being routing configuration; the dev stage keeps them as fixture seeds that insert one installation and one source per platform.

## Dashboard

One **Sources** page replaces Channels: a section per installation, headed by the descriptor's name and icon, listing its scopes with `scopeLabel`; a picker filled by `scopes.list` for that installation; and, for a platform the workspace has not connected, the descriptor's install action ("Add to Slack" is Slack's OAuth v2 with the app's client; "Install GitHub App" is the App's installation URL with the workspace in `state`). The install callbacks create `workspace_installations` rows; nothing else in the page names a platform. RPCs become `dashboardSources`, `dashboardListScopes(installationId)`, `dashboardAddSource`, `dashboardRemoveSource`, `dashboardInstallUrl(platform)`.

## Boundaries that do not move

- The registry hands out scopes and ports, never adapters; hosts cannot reach a provider client through it.
- Authorization stays in workspaces and control: an adapter answers platform questions and owns platform resources, it never decides whether a workspace may act.
- Provider secrets stay on the API Worker; the dashboard receives descriptors and status projections.
- Persist `ReplyTarget`, never handles.

## Increments

1. **Contract and registry.** `@notus/sources`, the two adapters wrapping today's code, `Platforms` provided by the API and Task hosts, tasks and control consuming it. Same tables, same fixture, no behaviour change; the offline harness passes unchanged.
2. **Installations and sources.** The two tables, `Access` on `(installation, scope)`, ingress routed by installation, fixture seeding through the same path, environment variables reduced to seeds.
3. **Dashboard.** The Sources page, scope listing through the registry, Slack and GitHub install flows and callbacks. Supersedes dashboard increment four's installation flow.
4. **Conformance.** The shared case list and each adapter's fixtures in the offline harness.

## Status

- **Increment one shipped on 2026-09-15.** `@notus/platform` holds the vocabulary (`Platform`, branded `InstallationId`/`PlatformId`, `Source` with an explicit `scope`, `Capabilities`, `PlatformDescriptor` with a total `PLATFORM_DESCRIPTORS`, `PlatformIngress`, `PlatformAdapter`, the `Platforms` registry and its errors). `domains/sources` (`@notus/sources/slack`, `@notus/sources/github`) implements it over the SDK packages; `apps/api/src/platforms.ts` builds one registry for both hosts and `apps/api/src/ingress.ts` is the single `/<platform>/events` route: the adapter verifies and normalizes, the route resolves the workspace, asks the adapter's `identity.mayParticipate`, attaches a conversation its task confirms it opened, and admits. The control inbox derives keys from `(platform, installation, scope, conversation, target)` uniformly and checks `input:start` against the descriptor; `Access.authorizeSource` is one lookup on `(installation, scope)`; an opened pull request records its `Source`, so attachment is an equality check. `workspace_channels`, the fixture and the environment variables are unchanged, as planned. Not in the contract yet: the descriptor's `install` action and the conformance suite.

# Codebase proposal

Proposed ownership, not implemented packages. Follows the [product requirements](../../CONTEXT.md) and [architecture rules](../architecture/CONTEXT.md); service imports and Layer conventions are defined there, not repeated here.

## Package layout

```text
packages/       contracts/ namespace/ herdr/ plannotator/ slack/ openai/ github/ cloudflare/
domains/        workspaces/ accounts/ tasks/ executions/
entrypoints/    control/ operator/
apps/           api/ devbox/
alchemy.run.ts
```

Introduce packages as needed, not empty scaffolding. `contracts` holds shared IDs, actor/conversation values, messages, and artifact references/digests. The other tier-1 packages communicate with their named providers.

## Domain ownership

| Domain | Owns |
| --- | --- |
| `workspaces` | Membership, repository/access policy, source-installation associations, environment profiles, versioned process configuration |
| `accounts` | Canonical users, verified external identity links, saved model connections, renewal/revocation, authorized usage grants |
| `tasks` | Request/origin, selected configuration, progress, questions/replies, plan revisions/approval capabilities, findings/dispositions, artifact associations, outbound notification intent |
| `executions` | Attempt identity/generation, devbox assignment, provisioning intent, specialist sessions/rounds, invocation outcomes and evidence |

Executions has control-side `/attempts` and devbox-side `/agents` modules. Agents use neutral session/review capabilities; local execution observations do not decide task completion. Keep these in one domain but do not require both hosts' dependencies in one service.

Tasks also owns the neutral `/conversation` and `/artifacts` capabilities. Execution collectors produce result candidates; entrypoints assemble artifact publication and acceptance. Artifact storage implementation is undecided.

Start without domain-to-domain implementation imports. A justified one-way dependency is legal; do not invent abstractions merely to avoid it. Reviewer specialties, planning, implementation, and QA are configured roles, not separate domains.

### Default provider mapping

Each capability exposes its default through the [canonical service namespace](../architecture/CONTEXT.md#services-and-layers). The implementation module remains inside that domain and imports the provider package.

| Capability | Default implementation | Provider package |
| --- | --- | --- |
| `executions/devbox` | `devbox/namespace` | `@bridle/namespace` |
| `executions/sessions` | `sessions/herdr` | `@bridle/herdr` |
| `executions/plan-review` | `plan-review/plannotator` | `@bridle/plannotator` |
| `tasks/conversation` | `conversation/slack` | `@bridle/slack` |
| `accounts/connections` | `connections/openai` | `@bridle/openai` |
| `workspaces/repositories` | `repositories/github` | `@bridle/github` |
| `tasks/store` | `store/cloudflare` | `@bridle/cloudflare` |

Reuse Effect's neutral `LanguageModel` for inference. `executions/model/openai` assembles the default using the OpenAI package and authorized runtime context; it does not own connection storage or refresh policy.

## Entrypoints

### `control`

Owns HTTP/WebSocket routes, control protocol/client, source registry, and cross-domain use cases: task start, account linking, human response, review decisions, execution observations, cancellation, and handoff delivery.

- Source-specific ingress uses the provider package for verification/decoding and the domain adapter for normalization. Only then does the shared use case resolve identity and authorize work.
- Combine workspace access checks with account ownership before granting execution access. A submitted user/connection ID is not authorization.
- Keep a durable source inbox and conversation-to-task index, including events received before a task exists. Persist the event before acknowledgement; process task creation/provisioning from recorded intent with stable IDs.
- Outbound delivery uses Tasks' conversation capability. A static adapter registry resolves source kind/installation; it is not the durable inbox or a workflow engine.
- `/client` exports the control protocol client without server handlers or app declarations. App-local remote adapters use it to provide restricted domain capabilities.

### `operator`

Owns the model driver, tool assembly, and default Markdown prompts under `prompts/`. It is an entrypoint because it assembles domains into an AI tool interface. Tool implementations call domain services, not provider SDKs.

Workspace configuration selects/overrides prompts; record the resolved process and repository configuration when creating the task. Later configuration edits must not silently change active work. Waiting uses scoped observers or event-driven resume, depending on the validated model transport.

## Runtime and data ownership

| Owner | Responsibility |
| --- | --- |
| `apps/api` | Alchemy Worker/DO declarations, native binding handles, listeners, and control runtime composition |
| Task DO | Authoritative task and task-scoped execution records, using separate domain-owned storage interfaces over its database |
| `apps/devbox` | Supervisor, local operator/agent/review processes, readiness/keepalive, result collection, remote clients, scoped runtime credentials, shutdown/failure reporting |
| Shared control stores | Workspace configuration, source inbox/routing/installations, user identity and provider connections; layout still undecided |
| Durable artifact store | Accepted immutable plans/results that must survive dev-box removal; provider still undecided |

The devbox provides a remote **domain service**, not a second business implementation over remote CRUD storage. It may report work and request questions/reviews/handoff, but cannot grant approval, rewrite execution authority, or own refresh-token rotation. Local journals, native session histories, and files are checkpoints/evidence, not another authoritative task record.

Accounts needs one logical durable refresh writer per connection. Dev boxes must not independently rotate copies of the same refresh token. Repository execution grants belong to workspace policy and are separate from model connections and deployment credentials.

Accept observations only for the current attempt/generation and invocation, deduplicating retries. Accepted code-related evidence must identify the inspected revision; preserve it during review and QA. Use meaningful commands with expected-revision checks rather than unrestricted state mutation. Record intent before external effects; never hold a database transaction across provisioning or model calls.

The review gateway validates a capability against a frozen plan and records the accepted decision through Tasks. Executions' plan-review service supplies UI readiness and observed outcomes only. CLI exit or agent-authored files cannot establish approval. Keep the gateway decision path and secrets isolated from repository-controlled processes. Backend reachability and isolation are [validation gates](../research/validation-plan.md).

Alchemy deploys the long-lived service; starting a task does not redeploy the stack. A separate `apps/provisioner` is conditional on the Namespace control-transport spike. No separate frontend is proposed for the existing Plannotator UI.

## Proposed initial limits and next step

Start with one active attempt and one checked-out repository per execution, retaining its dev box while live approval needs it. These are proposals, not settled answers to the [open product decisions](../../CONTEXT.md#open-product-decisions).

After agreeing ownership, use the [validation plan](../research/validation-plan.md) to choose stores, bootstrap/ingress paths, credential and approval isolation, and runtime composition. Then specify the service contracts and implementation sequence. Do not add generic database/workflow/plugin frameworks in anticipation of those decisions.

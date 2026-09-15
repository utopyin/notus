# Codebase proposal

Proposed ownership, not implemented packages. Follows the [product requirements](../../CONTEXT.md) and [architecture rules](../architecture/CONTEXT.md); service imports and Layer conventions are defined there, not repeated here.

## Package layout

```text
packages/       contracts/ stages/ namespace/ herdr/ plannotator/ slack/ openai/ github/ cloudflare/
domains/        workspaces/ accounts/ tasks/ executions/
entrypoints/    control/ operator/
apps/           api/ devbox/
alchemy.run.ts
```

Introduce packages as needed, not empty scaffolding. `contracts` holds shared IDs, actor/source references, messages, and artifact references/digests. `stages` holds deployment stage conventions only: which stage is production and which hostnames a stage owns. The other tier-1 packages communicate with their named providers.

## Domain ownership

| Domain       | Owns                                                                                                                                                                                                                                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspaces` | Membership, repository/access policy, source-installation associations, environment profiles, versioned process configuration                                                                                                                                                                                           |
| `accounts`   | Canonical users, verified external identity links, saved model connections, renewal/revocation, authorized forwarding of model requests, authorized usage grants                                                                                                                                                        |
| `tasks`      | Request/origin, source attachments and input/output configuration, inputs/reply targets/responses, selected process configuration, progress, questions/replies, plan revisions/approval capabilities, decisions/disclosure, findings/dispositions, artifact associations, acknowledgement/answer/update delivery intent |
| `executions` | Attempt identity/generation, devbox assignment, provisioning intent, operator steps, specialist sessions/rounds, invocation outcomes and evidence                                                                                                                                                                       |

Executions has control-side `/attempts` and devbox-side `/agents` modules. Agents use neutral session/review capabilities; local execution observations do not decide task completion. Keep these in one domain but do not require both hosts' dependencies in one service.

Tasks also owns the neutral `/sources` and `/artifacts` capabilities. Source adapters implement the [task-source model](../../CONTEXT.md#task-sources). Inputs, reply targets, responses, and delivery intents live in the Task DO. Given a response's input ID, resolve its target through the attached source and check enabled capabilities before delivery. Keep receipt reactions, targeted answers, and initiator updates distinct; attaching a source cannot change update routing. Provider IDs stay behind the adapter; no separate claim/request aggregate is proposed. Execution collectors produce result candidates; entrypoints assemble artifact publication and acceptance. Private R2 is the proposed artifact backend.

Start without domain-to-domain implementation imports. A justified one-way dependency is legal; do not invent abstractions merely to avoid it. Reviewer specialties, planning, implementation, and QA are configured roles, not separate domains.

### Default provider mapping

Each capability exposes its default through the [canonical service namespace](../architecture/CONTEXT.md#services-and-layers). The implementation module remains inside that domain and imports the provider package.

| Capability                             | Default implementation            | Provider package                |
| -------------------------------------- | --------------------------------- | ------------------------------- |
| `executions/devbox`                    | `devbox/namespace`                | `@notus/namespace`              |
| `executions/sessions`                  | `sessions/herdr`                  | `@notus/herdr`                  |
| `executions/plan-review`               | `plan-review/plannotator`         | `@notus/plannotator`            |
| `sources` (`@notus/platform` registry) | `sources/slack`, `sources/github` | `@notus/slack`, `@notus/github` |
| `accounts/connections`                 | `connections`                     | `@notus/openai`                 |
| `workspaces/repositories`              | `repositories/github` (planned)   | `@notus/github`                 |
| `tasks/store`                          | `store/cloudflare`                | `@notus/cloudflare`             |
| `tasks/artifacts`                      | `artifacts/r2`                    | `@notus/cloudflare`             |

Reuse Effect's neutral `LanguageModel` for inference. `@notus/openai` exposes the subscription-backend `LanguageModel` layer over a caller-supplied `HttpClient`; `apps/api` supplies the broker transport, so the model layer never sees a token. Connection storage and refresh policy stay in `accounts/connections`.

## Entrypoints

### `control`

Owns HTTP/WebSocket routes, control protocol/client, and cross-domain use cases: task start, source attachment, account linking, human response, review decisions, execution observations, cancellation, and handoff delivery.

- Source-specific ingress uses the provider package for verification/decoding and the domain adapter for normalization. Only then does the shared use case resolve identity and authorize work.
- Combine workspace access checks with account ownership before granting execution access. A submitted user/connection ID is not authorization.
- Keep a durable source inbox and source-to-task routing index, including events received before a task or attachment exists. Persist events before acknowledgement; process task creation/provisioning from recorded intent with stable IDs.
- After creating a PR through Workspaces' repository capability, attach its conversation through Tasks' sources capability. Reconcile retries and early webhook events without duplicate attachments or lost feedback.
- Inbound normalization and outbound delivery use Tasks' sources capability. Its static adapters resolve supported operations from source kind/installation and attachment configuration; they are not the durable inbox or a workflow engine.
- `/client` exports the control protocol client without server handlers or app declarations. App-local remote adapters use it to provide restricted domain capabilities.

### `operator`

Owns the model driver, tool assembly, and default prompts. It is an entrypoint because it assembles domains into an AI tool interface. Tool implementations call domain services, not provider SDKs. The loop runs inside the Task Durable Object: `control/operator` claims a persisted step under the host gate, the host runs one model round outside it, and the result is recorded as the next checkpoint. The [operator plan](operator.md) records the implemented increment.

Workspace configuration selects/overrides prompts; record the resolved process and repository configuration when creating the task. Later configuration edits must not silently change active work. Waiting uses scoped observers or event-driven resume, depending on the validated model transport.

Reviewer instructions delegate technical decisions and escalate product questions under the [decision policy](../../CONTEXT.md#decisions-and-human-review). Record adopted decisions through Tasks; human-review handoff includes their disclosure, not only code and findings.

## Runtime and data ownership

| Owner         | Responsibility                                                                                                                                                                                                                                      |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api`    | Control Worker, Alchemy D1/DO declarations and bindings, listeners/scheduled intake recovery, and runtime composition; the Worker itself only reaches the Connection object for status and revocation, never for forwarding                         |
| Task DO       | Authoritative task/execution records, source attachments, answers/delivery, decisions, and operator steps, through domain-owned storage interfaces; hosts the operator loop and its broker transport                                                |
| Shared D1     | Workspace configuration, membership, installation/verified identity lookup, durable pre-task inbox, and source-routing reservations through ordinary Worker-hosted services; workspace-owned rows are scoped, canonical user IDs remain independent |
| Connection DO | One saved connection per canonical user, serialized refresh/rotation, revocation, and idempotent forwarding of authorized model requests keyed by operation; it is the credential broker                                                            |
| Private R2    | Immutable accepted artifacts and large checkpoint blobs; Task records own references, digests, acceptance, and cleanup eligibility                                                                                                                  |
| `apps/devbox` | Supervisor, local specialist/review processes, readiness/keepalive, result collection, remote clients, scoped runtime credentials, shutdown/failure reporting                                                                                       |

The devbox provides a remote **domain service**, not a second business implementation over remote CRUD storage. It may report work and request questions/reviews/handoff, but cannot grant approval, rewrite execution authority, or own refresh-token rotation. Local journals, native session histories, and files are checkpoints/evidence, not another authoritative task record.

The Connection DO proxies authorized model requests rather than exporting provider tokens; the Task DO's model client has no transport other than that object. Renewal is serialized under the object's gate and persisted before use, but a provider's rotation and local storage cannot commit atomically; reconcile uncertain refresh outcomes without blindly replaying an old token. Repository execution grants remain separate from model connections and deployment credentials.

Keep repository commands outside the trust boundary of the supervisor, model credentials, and review service. Validate enforced container/namespace isolation without privileged access, shared secret mounts, or host sockets. Separate processes, OS users, or `Redacted` alone do not prove isolation. Specialist support for the broker is a gate, not permission to copy native OAuth caches into the workspace.

D1-to-Task routing and PR attachment are recorded cross-store operations, not distributed transactions. D1 reservations and worker claims use unique constraints and conditional updates rather than DO serialization. A scheduled Worker sweeps durable pending intake; immediate post-response forwarding is only an optimization. D1 uses Drizzle's Effect D1 driver and fixed atomic batches; Task DOs use the Effect SQLite DO driver and local synchronous transactions. Task checkpoints retain model/tool continuity, pending waits, and invocation identities before releasing keepalives. R2 object age does not determine retention; active-task artifacts must not expire under a blanket bucket rule.

Accept observations only for the current attempt/generation and invocation, deduplicating retries. Accepted code-related evidence must identify the inspected revision; preserve it during review and QA. Use meaningful commands with expected-revision checks rather than unrestricted state mutation. Record intent before external effects; never hold a database transaction across provisioning or model calls.

The review gateway validates a capability against a frozen plan and records the accepted decision through Tasks. Executions' plan-review service supplies UI readiness and observed outcomes only. CLI exit or agent-authored files cannot establish approval. Protect UI assets and frozen content as well as decision secrets from repository-controlled processes. Prefer an authenticated outbound review relay, registered against attempt/review/process generation, over assuming private Namespace ingress works. The gateway authorizes access before requesting wake and waits for a newly registered review process. Backend reachability and isolation are [validation gates](../research/validation-plan.md).

Alchemy deploys long-lived resources; starting a task does not redeploy the stack. The [devbox slice](devbox.md) uses a fetch-based native JSON control client behind `@notus/namespace`. The published SDK omits current create fields, while the newer wrapper is unpublished and has Node-oriented transports. Maintain the inspected wire contract in the provider package rather than importing `repos/` or translating a shared configuration model. This replaces the earlier recommendation to distribute a separate SDK build. Workerd and live API checks establish compatibility only for the exercised methods.

Bootstrap the supervisor in the Namespace box and use outbound control/review connections for later task execution. No Node intermediary, Cloudflare Container, or separate Plannotator frontend is planned. Resource composition stays in app declarations/root stack, without app-to-app imports.

For Herdr, prefer a narrow local socket adapter for the required protocol operations rather than importing the SDK's incompatible Effect graph. Retain the upstream server and validate readiness, result identity, and native resume. This trades a small maintained client for avoiding a second Effect runtime; [source evidence](../research/herdr.md) does not establish protocol interoperability.

## Implementation sequence

Repository scope, execution policy, and reliance on Namespace auto-sleep during human waits are [product requirements](../../CONTEXT.md#planning-and-execution). Validate releasing keepalives and restoring pending work/review processes on wake. Cleanup follows the [retention policy](../../CONTEXT.md#retention).

The [first tracer](tracer.md) defines runnable increments and the blocking probes drawn from the [validation plan](../research/validation-plan.md). The runtime/store choices above are reviewed recommendations, not successful experiments. Do not add generic database/workflow/plugin frameworks in anticipation of later requirements.

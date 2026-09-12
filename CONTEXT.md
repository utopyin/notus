# Bridle context

Status: product intent agreed; first source/documentation research pass complete. A [monorepo design](docs/plans/codebase.md) is proposed for review. Workspace tooling and local login scripts exist, but the orchestrator has not been implemented. Integration spikes and infrastructure decisions remain.

## Problem

A human currently transfers plans to implementation agents, starts several specialist reviews, collects feedback, sends it back for fixes, and repeats the process. The same human also prepares environments for QA. Bridle should automate that coordination while preserving human planning input, plan approval, final code review, and manual merge.

## Vocabulary

- **Workspace**: Bridle configuration and access boundary for a team. Not the same thing as a Herdr workspace or a Namespace workspace.
- **Task**: one requested unit of work and its conversation, execution, findings, and artifacts. Proposed terminology, not a restriction on task complexity.
- **Input adapter**: an integration that normalizes requests and replies from Slack, Linear, a terminal, or another source.
- **Origin conversation**: the thread, issue, or other return address from which a task was started.
- **Task Durable Object**: the task's persistent coordination and message-routing component on Cloudflare.
- **Dev box**: an execution environment running project services, the operator, and coding-agent sessions. Namespace is the initial provider, not part of the public interface.
- **Operator**: an AI agent instructed to follow the configured process. It decides what to launch, how to interpret results, which findings to send back, when to ask humans, and when to hand over.
- **Operator runtime**: the program implementing the operator's tools, waiting, persistence, model invocation, cancellation, and error reporting. It does not replace the operator's semantic decisions with a fixed state machine.
- **Specialist agent**: a planner, implementer, reviewer, or QA agent running in a managed session. Herdr is the initial session provider.
- **Finding**: a recorded issue from review or QA, with its history and disposition. Reporting the same unresolved defect twice does not make it resolved.
- **Human request**: a correlated question, approval request, or intervention request routed to the originating conversation or review page.
- **Artifact**: a plan, review report, test result, screenshot, or other output associated with a task.
- **Execution attempt**: a particular assignment of task work to a dev box and operator, with its own identity and generation. Replacing an attempt does not create a new task.
- **Agent invocation**: one requested round of work within a specialist session. Session continuity does not make two invocations interchangeable.
- **Provider connection**: a saved, user-owned model-provider login and its renewal/revocation state. It outlives individual tasks and dev boxes.

## Agreed behavior

### Inputs and team scope

Input types are interchangeable behind neutral Effect service contracts. **Slack is the first usable input adapter**, with task questions, approval links, and progress routed through the originating thread. Use **`@distilled.cloud/slack`** for outbound Slack Web API operations behind Bridle's adapter; event verification and domain mapping remain Bridle responsibilities. Linear and CLI adapters can follow. Begin with a shared team service configured for one workspace and multiple accessible GitHub repositories. Later multi-tenancy should not require mixing credentials or rewriting the configuration model.

Anyone who can participate in the task's originating conversation can answer its questions. The prototype does not require an additional task-owner authorization role.

### Provider login

The UX goal is one interactive provider login per user, with the connection securely persisted and reused across tasks and dev boxes. Users should not have to log in again for every task, agent, or dev-box replacement.

Refresh short-lived access tokens automatically and retain rotated credentials. Ordinary token expiry must not require human intervention. Ask the user to reconnect only when the provider requires it, such as revocation or an expired/nonrenewable session; a temporary network failure should not invalidate the saved connection.

The provider connection belongs to a user, independently of any task or dev-box lifetime. Scope access through the workspace's authorization rules. Being able to answer a task question or approve its plan does not grant access to another user's provider connection. Source-identity mapping and task credential selection still need design.

Provide an explicit disconnect/revoke flow. Do not promise that one login lasts forever or silently fall back to API billing. The credential store, refresh ownership, and specialist-agent authentication adapters remain implementation decisions to validate.

### Planning

The planner may ask multiple questions. The operator routes them through tools to the task Durable Object, which deterministically forwards them to the configured external integration.

The planner uses Plannotator for explicit human plan approval. The review page runs on the dev box and is made remotely reachable. Prototype access is an unguessable, task-scoped, expiring bearer link. Anyone holding the link may view and approve; forwarding it grants those rights.

The planner handles requested revisions and waits for human approval. It then returns the approved plan as Markdown to the operator. The planner must not continue directly into implementation.

### Execution and review

The operator launches implementation and specialist reviews. Default review roles cover low-level implementation correctness, regressions against previous code, architecture and project conventions, and QA. Each role's instructions live in Markdown. The precise scheduling, severity rules, and repository-specific QA commands remain design work.

The operator consolidates review feedback and sends it to implementation without routine human intervention. Reuse specialist sessions across rounds when possible. Record findings and their responses explicitly rather than relying only on agent memory.

Reviewers must explicitly say when they have no findings. Agent reasoning determines semantic completion; a terminal status or successful tool exit is not proof that the code is finished.

Tools may wait for hours without repeated model invocations. The operator resumes when results or human responses become available.

### State and routing

Use one Cloudflare Durable Object per task. It holds the main task status, receives normalized external input, routes external messages, and can store structured findings and their resolution history. The operator reports through typed tools. A WebSocket is a transport, not a persistence layer.

The dev box runs the operator and specialist sessions until handoff or intervention. Automatic crash recovery and Durable Object alarm-based supervision are not required for the first prototype. A crashed operator still needs runtime-level failure reporting where possible; silent infrastructure loss requires independent detection if reliable alerts become a requirement.

### Human handoff

Unrecoverable or unexpected failures result in an intervention message to the originating conversation. The initial intent is manual intervention, not a comprehensive autonomous recovery system.

Humans perform final code review, may request another change cycle, and merge themselves. Bridle never merges. The exact final review interface and post-handoff dev-box lifetime remain undecided.

Design requirement to investigate: omitting a merge tool is insufficient if a coding agent can run `gh` or call GitHub with broad credentials. Repository permissions and branch protection must support the no-merge boundary.

## Provider boundaries

Provider communication belongs in `packages/`. Provider-neutral Effect service contracts belong in `domains/`, along with implementation Layers that import the provider packages. Apps select/configure the domain-exported defaults.

For example, callers use a neutral devbox service. Its Namespace implementation Layer lives in the owning domain and calls `@bridle/namespace`. The same split applies to sessions/Herdr, plan review/Plannotator, conversation/Slack, and model-provider connections. Provider packages never import the domain interfaces they support.

Neutral contracts include inputs, results, identifiers, errors, and lifecycle semantics. They must not expose the chosen SDK or vendor configuration. The happy path is one focused import such as `import { Devbox } from "@bridle/executions/devbox"`, exposing `Devbox.Service`, `Devbox.layer`, and `Devbox.layerNoDeps` together. No separate `/layer` import is required. Contract-only exports are reserved for genuine cross-runtime/import-isolation needs; the public service module may load provider dependencies. Replacing a provider may require changing configuration and migrating private provider bindings, but not rewriting callers.

Services should have a minimal default path. Their `layer` bundles sensible default dependencies recursively; `layerNoDeps` leaves those dependencies unprovided for explicit composition or integration tests. An optional `layerTest` can package reusable test wiring later. Apps supply genuine host/configuration/authority requirements once, and service calls reuse that runtime rather than constructing dependency graphs. Defaults must not conceal user credentials, task authority, or production dependencies inside test compositions.

See [the architecture rules](docs/architecture/CONTEXT.md) and [proposed capability mapping](docs/plans/codebase.md). The ownership and default-Layer rules are agreed; the precise grouping of capability modules remains part of the proposal.

## Technology intent

- Effect TypeScript **v4** for service contracts, implementations, tool definitions, and runtime logic.
- **Alchemy v2** for infrastructure-as-code and deployment, with `alchemy.run.ts` as the stack entrypoint. Use its Effect-based APIs. Infrastructure deployment and per-task devbox lifecycle are separate concerns; exact resource ownership remains part of the architecture plan.
- Cloudflare Workers and Durable Objects for ingress, task state, and deterministic external routing.
- Namespace dev boxes for isolated execution environments and project service setup.
- Herdr and the Dylan Milroy TypeScript SDK for coding-agent terminal management.
- Plannotator for human plan review.
- Prefer OpenAI subscriptions for AI usage, subject to documented authentication support. API billing is not an accepted fallback by default.

These are research targets, not claims of tested interoperability.

## Non-goals for the first prototype

- Automatic merge or production deployment.
- A generic visual workflow builder.
- Full multi-tenant account administration and billing.
- Automatic recovery of every agent or dev-box failure.
- Implementing every conceivable input adapter at once.

## Questions left for the architecture proposal

Do not silently decide these during research:

- Representative repository/QA target for the Slack-first implementation.
- One or multiple repositories checked out within a single task.
- How the final review and subsequent human-requested changes enter the existing task.
- Execution limits, cancellation, duplicate/conflicting replies, and review disagreement handling.
- Dev-box and artifact retention while waiting for humans and after handoff.
- Identity used for GitHub changes, mapping input-source users to saved provider connections, and selecting the authorized connection for a task.

Research may uncover additional feasibility decisions. Capture them separately from settled product requirements.

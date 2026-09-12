# Bridle context

Status: product intent agreed; first source/documentation research pass complete. Integration spikes and architecture decisions remain. No application has been implemented.

## Problem

A human currently transfers plans to implementation agents, starts several specialist reviews, collects feedback, sends it back for fixes, and repeats the process. The same human also prepares environments for QA. Bridle should automate that coordination while preserving human planning input, plan approval, final code review, and manual merge.

## Vocabulary

- **Workspace**: Bridle configuration and access boundary for a team. Not the same thing as a Herdr workspace or a Namespace workspace.
- **Task**: one requested unit of work and its conversation, execution, findings, and artifacts. Proposed terminology, not a restriction on task complexity.
- **Input adapter**: an integration that normalizes requests and replies from Slack, Linear, a terminal, or another source.
- **Origin conversation**: the thread, issue, or other return address from which a task was started.
- **Task Durable Object**: the task's persistent coordination and message-routing component on Cloudflare.
- **Dev box**: the Namespace environment running project services, the operator, and coding-agent sessions.
- **Operator**: an AI agent instructed to follow the configured process. It decides what to launch, how to interpret results, which findings to send back, when to ask humans, and when to hand over.
- **Operator runtime**: the program implementing the operator's tools, waiting, persistence, model invocation, cancellation, and error reporting. It does not replace the operator's semantic decisions with a fixed state machine.
- **Specialist agent**: a planner, implementer, reviewer, or QA agent managed through Herdr.
- **Finding**: a recorded issue from review or QA, with its history and disposition. Reporting the same unresolved defect twice does not make it resolved.
- **Human request**: a correlated question, approval request, or intervention request routed to the originating conversation or review page.
- **Artifact**: a plan, review report, test result, screenshot, or other output associated with a task.

## Agreed behavior

### Inputs and team scope

Input types are interchangeable behind neutral Effect service contracts. Initial input adapters have not yet been selected. Begin with a shared team service configured for one workspace and multiple accessible GitHub repositories. Later multi-tenancy should not require mixing credentials or rewriting the configuration model.

Anyone who can participate in the task's originating conversation can answer its questions. The prototype does not require an additional task-owner authorization role.

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

## Technology intent

- Effect TypeScript **v4** for service contracts, implementations, tool definitions, and runtime logic.
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

- First input adapter and representative repository/QA target.
- One or multiple repositories checked out within a single task.
- How the final review and subsequent human-requested changes enter the existing task.
- Execution limits, cancellation, duplicate/conflicting replies, and review disagreement handling.
- Dev-box and artifact retention while waiting for humans and after handoff.
- Identity used for GitHub changes and subscription-backed agents in a shared team service.

Research may uncover additional feasibility decisions. Capture them separately from settled product requirements.

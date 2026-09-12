# Product context

Bridle replaces manual coordination between coding agents. The AI operator decides what to run, interprets results, requests fixes, asks humans, and decides when work is ready for review. Typed tools enforce authorization and record work; they do not implement a fixed planning-to-implementation state machine.

Build status is in [README](README.md). [Architecture](docs/architecture/CONTEXT.md) defines code conventions; the [codebase proposal](docs/plans/codebase.md) assigns ownership.

## Vocabulary

| Term | Meaning |
| --- | --- |
| Workspace | A team's configuration and access boundary, distinct from provider workspaces |
| Task | Requested work, its origin conversation, progress, questions, findings, and artifacts |
| Origin conversation | The thread, issue, or terminal conversation used as the return address |
| Input adapter | Normalizes a source's requests and replies |
| Execution attempt | One assignment of a task to a dev box/operator; replacement retains the task ID |
| Dev box | Environment running project services, the operator, and specialist sessions |
| Specialist / invocation | An agent role / one requested round within its reusable session |
| Finding | A review or QA issue with history, responses, and disposition |
| Artifact | A plan, report, test result, screenshot, or other recorded output |
| Provider connection | A saved user-owned model login and its refresh/revocation state |
| Operator runtime | Tools, model calls, persistence, waiting, cancellation, and failure reporting |

## Required behavior

### Team and communication

- Start with one shared workspace and multiple accessible repositories; preserve credential and configuration boundaries for later multi-tenancy.
- Slack is first. Send questions, approval links, progress, and handoff to the originating thread. Other inputs must fit the same neutral contracts.
- Anyone participating in that conversation may answer questions. This grants no access to another user's provider connection.

### Planning and execution

- The planner can ask repeated questions and revise its plan. Human approval binds the exact Markdown revision.
- The review UI runs on the dev box behind an unguessable, task-scoped, expiring bearer link. Any holder can view and approve; forwarding the link grants those rights.
- After approval, the planner returns the approved Markdown to the operator and does not implement it.
- The operator autonomously coordinates implementation, specialist reviews, fixes, and QA preparation. Default review roles cover correctness, regressions, architecture/conventions, and QA. Role instructions are Markdown.
- Reuse specialist sessions where possible, but persist findings and responses independently. Reviewers explicitly report when they have no findings. Terminal exit is not semantic completion.
- Tools may wait for hours without repeated model calls, resuming on results or human input.
- One Cloudflare Durable Object per task holds authoritative progress and routes structured input/output. The dev box runs the operator and specialists until handoff or intervention.

### Login and authority

- Connect each user's model account once, securely retaining credentials across tasks and dev-box replacements. Refresh automatically and retain rotated tokens.
- Request reconnection only when the provider requires it. Temporary network failure must not invalidate a saved connection. Support disconnect/revocation.
- Authorize connection use through workspace policy. Conversation participation and plan-link possession confer no credential rights.
- Prefer subscription-backed OpenAI usage. Never silently fall back to API billing.
- Humans perform final code review, may request further changes, and merge. Bridle never merges or deploys to production. Permissions and branch protection must enforce this beyond merely omitting a merge tool.
- Report unrecoverable failures in the origin conversation. Catch operator failures where possible; automatic crash recovery and full host-loss detection are not prototype requirements.

## Selected technology

Effect v4, Bun workspaces/Turborepo, and Alchemy v2 with `alchemy.run.ts`; Cloudflare Workers/Durable Objects; Namespace dev boxes; Herdr sessions; Plannotator review; `@distilled.cloud/slack` for Slack Web API calls. These choices are not proof of interoperability. See [research](docs/research/README.md).

## Open product decisions

- Slack task-start gesture and representative repository/QA target.
- One or multiple checked-out repositories per task.
- GitHub execution identity, source-user linking, and selection of the task's authorized model connection.
- Final-review interface and how requested changes re-enter the task.
- Execution limits, cancellation behavior, conflicting replies, and review disagreements.
- Dev-box and artifact retention during human waits and after handoff.

Do not add a workflow editor, full tenant administration, every input adapter, or comprehensive autonomous recovery to the first prototype. Technical unknowns belong in the [validation plan](docs/research/validation-plan.md).

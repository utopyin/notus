# Product context

Notus replaces manual coordination between coding agents. The AI operator decides what to run, interprets results, requests fixes, asks humans, and decides when work is ready for review. Typed tools enforce authorization and record work; they do not implement a fixed planning-to-implementation state machine.

Build status is in [README](README.md). [Architecture](docs/architecture/CONTEXT.md) defines code conventions; the [codebase proposal](docs/plans/codebase.md) assigns ownership.

## Vocabulary

| Term                    | Meaning                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| Workspace               | A team's configuration and access boundary, distinct from provider workspaces                               |
| Task                    | Requested work, attached sources, progress, questions, findings, and artifacts                              |
| Source                  | A specific external conversation attached to a task, such as a Slack thread or GitHub PR conversation       |
| Origin conversation     | The source where the task began; the initiator's destination for task updates                               |
| Source adapter          | Implements a source kind's supported input/output operations and translates provider data                   |
| Input                   | A durable item received through a task source; human messages require an eventual answer                    |
| Reply target            | A durable source-specific address for responding to an input, such as a particular comment or review thread |
| Response                | An answer referencing an input; several responses may precede a final answer                                |
| Execution attempt       | One assignment of a task to a dev box/operator; replacement retains the task ID                             |
| Dev box                 | Environment running project services, the operator, and specialist sessions                                 |
| Specialist / invocation | An agent role / one requested round within its reusable session                                             |
| Finding                 | A review or QA issue with history, responses, and disposition                                               |
| Artifact                | A plan, report, test result, screenshot, or other recorded output                                           |
| Provider connection     | A saved user-owned model login and its refresh/revocation state                                             |
| Operator runtime        | Tools, model calls, persistence, waiting, cancellation, and failure reporting                               |

## Required behavior

### Team and communication

- Start with one shared workspace and multiple accessible repositories; preserve credential and configuration boundaries for later multi-tenancy.
- Slack is first. An explicit `@Notus` mention starts a task. Once a thread belongs to a task, replies and further mentions continue that task rather than creating another.
- Final code review happens on a GitHub pull request linked in Slack. Human PR feedback and Slack replies can continue the existing task; the operator decides whether they require further work. Feedback does not change its selected model-account owner.
- Workspace policy allows GitHub collaborators with write access to resume tasks through PR feedback without a linked Notus account. Other feedback is review context, not independent authorization to run. Notus's own output must not trigger another round.
- Anyone participating in that conversation may answer questions. This grants no access to another user's provider connection.

### Task sources

- A task has multiple attached sources. GitHub is a provider; a particular PR conversation is a source. Creating the task's PR attaches that conversation through the same source model, not a separate GitHub feedback workflow.
- Source adapters declare supported input/output capabilities. Each attachment configures which capabilities are enabled and which outputs it receives. Unsupported operations cannot be enabled; attachment alone does not authorize actors or credential use.
- The originating Slack thread receives the initiator's questions, approval links, progress, decision summaries, and handoff. Additional sources cannot take over or subscribe themselves to that update channel.
- The PR source receives human reviews/comments and supports targeted replies to that feedback, with general task updates disabled. Reply capability and update delivery are separate. A supported reply operation resolves a source-specific target into a handle so callers do not implement provider routing.
- Every human question or message admitted to the task requires an eventual answer. Acknowledge receipt with a reaction where supported, without an immediate model-generated reply. Acknowledgement does not discharge the answer obligation. Provider lifecycle events and Notus's own output do not create human-message answer obligations.
- Persist each input with its source, conversation context, reply target when supported, and answer obligation. Requiring an answer does not itself authorize execution. Unsupported delivery must remain explicit rather than silently losing the obligation.
- Structured responses reference the input ID and route to its specific reply target. Avoid redundant intermediate messages; an input may receive several substantive responses before its final answer. Final answers complete the answer obligation, not the task or source conversation. Follow-up messages are new inputs.
- Reply targets survive runtime restarts. Store durable provider references, not executable handles or credentials; the adapter resolves a handle when delivering. Response creation and external delivery are distinct, so an undelivered answer must not be reported as delivered.

### Planning and execution

- Each task targets one repository selected from the workspace's accessible repositories. Cross-repository tasks are outside the first version.
- A workspace selects its devbox provider and stores its native configuration as opaque JSON. The provider package owns decoding, encoding, and validation; Notus does not translate a shared machine-configuration model into provider settings.
- Provide a default Notus image containing Herdr and its supporting runtime. Teams can derive images with their own tools and use the provider's native configuration to select them. A default image is not a shared running devbox.
- The first end-to-end target is a dedicated disposable web-app repository with a runnable UI and build checks, not a production application.
- The planner can ask repeated questions and revise its plan. Human approval binds the exact Markdown revision.
- The review UI runs on the dev box behind an unguessable, task-scoped, expiring bearer link. Any holder can view and approve; forwarding the link grants those rights.
- After approval, the planner returns the approved Markdown to the operator and does not implement it.
- The operator autonomously coordinates implementation, specialist reviews, fixes, and QA preparation. Default review roles cover correctness, regressions, architecture/conventions, and QA. Role instructions are Markdown.
- Reuse specialist sessions where possible, but persist findings and responses independently. Reviewers explicitly report when they have no findings. Terminal exit is not semantic completion.
- Tools may wait for hours without repeated model calls, resuming on results or human input.
- Initially impose no Notus-specific execution-time, specialist-count, workspace-capacity, or spend caps; respect provider/runtime limits. Keep one authoritative active attempt per task as a consistency invariant, not a usage limit.
- Rely on Namespace auto-sleep during human waits, without a Notus-imposed response deadline. Sleeping must not cancel the task or discard pending questions/plans. Approval-link expiry is independent of the time allowed to respond.
- One Cloudflare Durable Object per task holds authoritative progress, routes structured input/output, and runs the operator loop: each model round and tool result is a persisted step, so waiting costs no model calls and survives restarts. The dev box runs specialists and repository work only through operator tools; it never hosts the operator or its credentials.
- The operator's system prompt carries the task's current state, including whether a dev box exists. Any tool that touches the dev box ensures it exists and is awake; the operator does not manage sleep.

### Decisions and human review

- Reviewers handle engineering decisions and raise product questions to the human. Technical assumptions still require evidence; reviewer agreement is not proof of runtime compatibility.
- Authorized human instructions take precedence over agent recommendations, without overriding access controls or the no-merge/no-production-deployment boundaries. Reviewer disagreements become human questions. Contradictory human instructions go to the initiator rather than using latest-message precedence.
- Record every adopted decision with its rationale and any superseded decision. Before human review, clearly disclose all decisions from the preceding automatic work. Include planning decisions with plan approval and subsequent decisions with the code-review handoff; do not rely on scattered agent messages. Changes requiring renewed plan approval must not wait until final handoff.

### Login and authority

- At account creation or workspace onboarding, users link their Slack identity and connect their model account to their Notus account. Verify account ownership rather than accepting a supplied Slack user ID.
- Connect each user's model account once, securely retaining credentials across tasks and dev-box replacements. Refresh automatically and retain rotated tokens.
- Request reconnection only when the provider requires it. Temporary network failure must not invalidate a saved connection. Support disconnect/revocation.
- A Slack-started task uses its initiator's saved model connection, subject to workspace authorization. If none is authorized, request connection setup; never silently use another person's connection. Later conversation participants do not change the selected owner.
- Authorize connection use through workspace policy. Conversation participation and plan-link possession confer no credential rights.
- Prefer subscription-backed OpenAI usage. Never silently fall back to API billing.
- Repository execution uses a dedicated GitHub App installed on allowed repositories. Its credentials are separate from model connections and deployment credentials.
- Humans perform final code review, may request further changes, and merge. Notus never merges or deploys to production. Permissions and branch protection must enforce this beyond merely omitting a merge tool.
- The task initiator and workspace admins may cancel or explicitly resume a task. Cancellation stops active work, preserves the branch and accepted evidence, and blocks automatic resumption from later comments. It does not undo completed external actions.
- Report unrecoverable failures in the origin conversation. Catch operator failures where possible; automatic crash recovery and full host-loss detection are not prototype requirements.

## Selected technology

Effect v4, Bun workspaces/Turborepo, and Alchemy v2 with `alchemy.run.ts`; Cloudflare Workers, shared D1 for workspace/control data, and task Durable Objects; Drizzle with first-party Effect drivers/schema integration; Namespace dev boxes; Herdr sessions; Plannotator review; `@distilled.cloud/slack` for Slack Web API calls. Workspaces use ordinary SQL-backed services, not workspace Durable Objects. These choices are not proof of interoperability. See [research](docs/research/README.md).

## Retention

Only the initiator and workspace admins may explicitly close or reopen a task. Comments do not automatically reopen closed tasks. Retain task records and artifacts while open and for 90 days after explicit closure; reopening within that window cancels cleanup, and a later closure starts a new window. Handoff for human review does not start the clock. Saved model connections have a separate lifecycle; sleeping devboxes remain subject to Namespace's retention policy.

Do not add a workflow editor, full tenant administration, every input adapter, or comprehensive autonomous recovery to the first prototype. Technical unknowns belong in the [validation plan](docs/research/validation-plan.md).

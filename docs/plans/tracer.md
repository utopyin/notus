# First tracer

Proposal, not implementation or deployment approval. [Product context](../../CONTEXT.md) owns behavior; [codebase](codebase.md) owns services and runtime/data placement. This plan owns the first complete scenario, implementation order, and demonstration criteria.

## One complete task

Use a disposable web app with one visible bug, such as a filter that leaves completed items visible. The request arrives through `@Notus` in Slack. The operator obtains an approved plan, coordinates a fix and specialist review/QA, then presents a PR and the adopted decisions. A human posts PR feedback; the existing task processes it and answers that specific feedback on GitHub. General updates remain in the original Slack thread. A human merges separately.

This is the acceptance scenario, not a hardcoded workflow. The operator chooses actions and interprets results. Tools enforce grants, approval, durable records, and the active-attempt invariant.

## Build in runnable increments

| Increment                                 | Demonstrates                                                                                                                                                                                                    |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. [Durable source round trip](intake.md) | A signed Slack input reaches a task, receives a non-model acknowledgement, and later gets a targeted answer. A simulated worker proves persistence and retry handling without model or devbox dependencies.     |
| 2. Real execution                         | Replace the simulated worker with a Namespace box and an Effect operator controlling Herdr. Run a harmless assignment, persist a tagged result, and demonstrate that waiting does not poll the model.           |
| 3. Approved repository change             | Add the strict Plannotator gate, immutable plan, trusted decision recording, implementation, specialist review, and browser QA. No implementation permission comes from a simulated or agent-authored approval. |
| 4. Attached PR conversation               | Create the PR, attach its source idempotently, consume authorized human feedback, and publish its answer to the original comment/thread. Reuse the task, connection owner, and findings.                        |
| 5. Sleep and handoff                      | Sleep during a human wait, then restore pending work without losing answer obligations or accepting stale results. Disclose decisions and accepted evidence before human code review.                           |

Create only packages required by each increment. Simulation proves the control contract, not provider compatibility. The tracer is complete only after the real scenario works.

## Experiments that determine the implementation

Run narrow probes from the [validation plan](../research/validation-plan.md), not its entire backlog. Use offline fixtures first. Live probes need explicit accounts, resources, cleanup ownership, and authorization; the product's uncapped defaults are not permission for an unbounded experiment.

| Gate                         | Evidence required before relying on it                                                                                                                                                                                                                                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime and distribution     | Reproducible Notus Effect dependencies, narrow Herdr client/server compatibility, and the chosen specialist executable; real Worker bundling of Distilled; a usable Namespace SDK artifact.                                                                                                                                      |
| Namespace control and wake   | Use the packaged, commit-pinned devbox SDK directly from the Worker/DO; check workerd compatibility during its normal build. Verify authenticated create/inspect/activate and reconciliation. Releasing keepalives permits sleep; waking restores the supervisor and pending review/wait from durable state, not an old Promise. |
| Model credential boundary    | The operator and chosen specialist host work with the selected user's connection through expiry without receiving provider tokens or exposing secrets to repository processes. Confirm the applicable provider-supported identity/billing arrangement independently of technical success. No silent API-billing path.            |
| Human approval boundary      | The browser sees the frozen bytes; only the authorized gateway decision approves that revision. The public UI survives the chosen proxy path, and repository processes cannot forge approval or access unrelated controls.                                                                                                       |
| GitHub authority and replies | Installation permissions permit the task branch, PR, and targeted replies while protected-branch policy prevents Notus from merging. Verify webhook actor checks, reaction/reply capabilities, and exact reply-target mapping.                                                                                                   |

A failed gate changes the technical implementation, not the product requirement. Escalate if no implementation satisfies the requirement; do not replace real approval, isolated credentials, or automatic sleep with a convenient simulation.

## Demonstration criteria

- Replay the same Slack event and lose one provisioning acknowledgement. Retain one admitted input, task, attachment, and authoritative attempt; reconcile any uncertain external effect before retrying it.
- Every human input has a durable answer obligation. Receipt reactions do not satisfy it. Deliver substantive answers to their reply targets without a separate model-written acknowledgement.
- Publish and approve exact plan bytes. Request a revision once and verify that the earlier decision/link cannot approve replacement bytes. The planner returns the approved Markdown and stops before implementation.
- Persist invocation- and code-revision-bound review/QA results, including an explicit no-findings result. Findings and decisions remain readable without native agent history.
- Attach the created PR as a source. Replay an early webhook around attachment, reject unauthorized execution triggers, and avoid loops from Notus's own messages. PR feedback never takes over initiator updates.
- Exercise a human wait across Namespace sleep. Pending inputs, model continuation, review state, and reply targets survive; no model calls run merely to check for completion. Unknown in-flight effects reach reconciliation or intervention, not blind replay.
- Deliver the decision record before human review, with the PR and evidence. Human instructions take precedence and reviewer disagreements become human questions.
- Cancel through an authorized actor and verify later feedback cannot automatically restart work. Preserve accepted evidence after box deletion. Verify the 90-day-after-closure cleanup rule with controlled time rather than waiting 90 days.

Full tenant administration, a plugin framework, a workflow editor, production deployment, every source type, and comprehensive crash recovery remain outside this tracer.

Closure, reopening, and cleanup follow the [retention policy](../../CONTEXT.md#retention).

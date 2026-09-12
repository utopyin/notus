# Herdr integration evidence

Paths below are relative to `repos/herdr/` unless prefixed with `repos/herdr-ts-sdk/`. [Sources](sources.md) owns pins and the SDK's unpublished-baseline/Effect mismatch. No agent or SDK runtime was launched. Upstream tests were read, not run. Experiments belong in [validation](validation-plan.md).

## Compatibility and host boundary

- The initial review parsed and compared `docs/next/api/herdr-api.schema.json` with `repos/herdr-ts-sdk/schema/herdr-api.schema.json`. JSON values match; formatting differs. This removes an obvious wire-schema mismatch, not the SDK's different expected server revision or Effect dependency incompatibility.
- `repos/herdr-ts-sdk/src/herdr-transport.ts` pings before requests, rejects unsupported protocols, and caches successful compatibility indefinitely per transport. Rebuild/re-ping after endpoint replacement; a cached check does not certify a new server.
- Herdr needs PTYs, shells, agent executables, files, and a local socket. The SDK targets Node/local sockets, not Workers. Socket mode `0600` is a same-user boundary, not isolation from agents using that user. Evidence: `src/api/server.rs`.
- SDK builds regenerate wire files. Use a release or separately built artifact, not builds/imports from `repos/`.

## Control and readiness

Evidence: `docs/next/website/src/content/docs/agent-automation.mdx`, `src/app/{agents.rs,api/agents.rs}`, `src/cli/agent.rs`; SDK `src/{agent-service,herdr-models,workspace-service,pane-service,event-service,session-service}.ts`.

- Topology is session/server → workspace → tab → pane. Workspace/tab creation returns a root pane; `agents.start` requires an available shell pane and creates no topology. Set cwd when creating the pane, not in agent start.
- Use returned identifiers. A live agent name is an alias, not a durable conversation ID. Moving a pane changes its public pane ID and can invalidate waits. Track terminal identity and native session reference as well as pane ID.
- SDK `agents.start` acknowledges command submission. Unlike the CLI, it does not retry shell readiness or wait for the expected kind/terminal to become interactive. `agents.wait` checks status only and is not a launch-readiness guarantee.
- Readiness must include expected terminal/kind, `interactiveReady`, `!launchPending`, and an available status. Treat startup dialogs as blockers, not permission to submit. The server launch timer and SDK request deadline are independent.

Useful SDK entrypoints, not a complete API tutorial:

| Need | Source API |
| --- | --- |
| Create layout | `workspaces.createInDirectory`, `tabs.create`, `panes.split` |
| Launch/inspect | `agents.start`, `agents.get` |
| Submit/wait | `agents.prompt`, `agents.wait` return `Agent`, not answer Markdown |
| Read output | `agents.read` / `panes.read`; SDK source spelling `recent_unwrapped`, CLI `recent-unwrapped` |
| Reconcile | `session.snapshot`; `events.subscribe` / `events.wait` for live observations |
| Native session metadata | `panes.reportAgentSession`, not a general resume command |

## Waits do not prove a completed invocation

Evidence: `src/api/wait.rs`, `src/app/api/agents.rs`, `src/terminal/state.rs`; SDK `src/{herdr-transport,event-service}.ts`, `herdr-protocol-22.test.ts`.

- Standalone waits can return immediately from existing state. Default settled states include `idle`, `done`, and `blocked`. None means successful implementation or an empty review.
- Prompting a blocked agent fails before writing. Otherwise text and delayed Enter are queued. A prompt with wait expects working/blocked activity within five seconds when starting outside working; a stalled/timeout result does not prove non-delivery. Prompting while already working may wait for that existing turn instead.
- Server waits pin terminal identity and detect lifecycle replacement/move/exit, but carry no Bridle invocation ID or result hash. Only one outstanding invocation per specialist session avoids cross-turn confusion.
- Lifecycle hooks are authoritative where available; other integrations use screen/process heuristics. Output waits search existing snapshots, so echoed prompts and old text can match immediately. Reads are bounded, may truncate, and can scroll an idle alternate screen. They are not a durable transcript API.
- SDK request timeout defaults to five seconds, independently of server `timeoutMs`. Server waits may be indefinite when omitted. Budget SDK and outer tool deadlines beyond server wait/submission overhead.
- Waits use socket I/O without model calls. Events are live-only, cold streams subscribe when consumed, and interruption closes the socket. Reconnect needs snapshots and result reconciliation, not assumed event replay or automatic resubmission.
- Disconnecting an observer does not establish that the worker stopped. Cancellation and ambiguous prompt delivery require separate observations.

## Session continuity and result evidence

Evidence: `docs/next/website/src/content/docs/session-state.mdx`, `src/persist/restore.rs`, `src/{agent_resume.rs,app/agent_resume.rs}`, `tests/detach_reattach.rs`.

- Client detach or connection loss leaves the background server and pane processes running. Server/machine restart loses those original processes; layout restoration is not uninterrupted execution.
- Native resume needs supported official integration metadata plus the agent's own session files/configuration. Herdr history is off by default because terminal output may contain secrets. Replayed screen history is not conversation memory.
- Resume normally waits for terminal dimensions/theme context. Entirely unattended restoration of hidden panes is untested. SDK `clientShell` sizing is a candidate, not a proven fix.
- Native launch reconstruction is constrained. Ordinary metadata reports are not arbitrary resume authority; source has a narrow Codex `resume` launch-argument exception. Do not assume all custom launch arguments survive.
- Experimental live handoff can preserve PTYs, but requests/subscriptions may break. Native compaction, clearing history, or session switching can still change reviewer memory.
- The SDK README's integration list is stale; `IntegrationTarget` and `integration-service.ts` include more hosts. Check the selected host's actual integration, not the README list alone.
- No reviewed SDK method returns a durable semantic result document. Herdr's automation guide recommends writing Markdown when terminal reads are insufficient. A result needs independently validated invocation/revision identity, path, size, and digest; a local file or terminal sentinel alone is not accepted durable evidence.
- Preserve accepted artifacts outside the deletable box. Keep finding history independent of agent memory. The exact record ownership is in [the codebase plan](../plans/codebase.md), not Herdr.

# Research findings

Research date: 2026-09-12. First source/documentation pass complete. **The overall design is plausible, but the supplied libraries do not compose unchanged into the proposed system.** No Bridle application, live agent integration, authentication flow, cloud deployment, or browser approval test has been implemented or run.

Start with [product context](../../CONTEXT.md). Source revisions and package versions are recorded in [sources.md](sources.md).

## What changes the architecture

| Area | Verified finding | Consequence |
| --- | --- | --- |
| OpenAI subscriptions | Effect does not ship subscription login, but Erudane implements OAuth and configures its existing OpenAI provider for the Codex backend. Platform API billing remains separate. | An Effect-native subscription-backed operator is a concrete candidate. Evaluate Erudane's adapter, runtime refresh, backend support, and exact tool compatibility before requiring a Codex-owned operator. See [correction](erudane-auth.md). |
| Shared-team identity | Business/Enterprise access tokens support trusted Codex automation. Non-human workspace service accounts explicitly support shared workflows, but require pay-as-you-go plans. | Define whether the goal is no Platform API billing or strictly fixed-price subscription usage. Confirm the allowed shared-team identity and entitlement before provisioning credentials. |
| Effect versions | Primary source is `4.0.0-rc.115`; `@herdr/sdk@0.9.0` directly depends on `4.0.0-beta.105`. | Choose a tested compatible package set, an updated SDK, or an isolated adapter boundary. Do not assume all v4 prereleases interoperate or solve this with unchecked dependency overrides. |
| SDK distribution | Herdr SDK's README describes its baseline as unpublished. Namespace source is `1.1.0`, while the inspected public npm `latest` was `1.0.0` without the high-level devbox client. | Recheck releases and packaged exports. Use a released package, a separately built pinned artifact, or a supported CLI adapter. Do not import application code from `repos/`. |
| Namespace in Workers | The SDK uses Node connection behavior absent from Workers; agent exec additionally requires functional Node HTTP/2. | Use a supported fetch-based lifecycle subset if validated, or a trusted Node control adapter. Run execution and Herdr locally in the dev box. |
| Public plan review | Namespace's documented devbox URLs require Namespace authentication. Plannotator's built-in sharing is not the live approval endpoint; its local server does not provide the agreed expiring bearer authorization. | Add a Bridle review gateway, keep the backend private, and verify how that gateway reaches Namespace. |
| Dev-box lifetime | A working agent/build is not sufficient to prevent idle shutdown. Namespace documents `/.namespace/tasks` markers. Stop/start preserves files, not all running processes. | Keep active work and live reviews explicitly active, with cleanup and a cost policy. Do not assume pause/resume preserves waiting callbacks. |
| Agent results | Herdr provides terminal control, lifecycle state, and reads. It does not return a durable semantic result document. | Bind each invocation to an explicit result artifact. Let the operator interpret it; never equate `idle`/`done` with a completed implementation or clean review. |

Evidence and qualifications are in the component reports below. Source/API mismatches are not proof that an adapter cannot be built; they identify the work the architecture must include.

## What fits without changing the product

- The operator can remain an AI agent that chooses the next action. The program can validate, execute, record, and wait without owning semantic workflow decisions.
- Effect v4 has the service, Layer, Schema, toolkit, concurrency, resource-lifetime, and model interfaces needed for those tools. Use `Context.Service`, `effect/unstable/ai`, and provider packages such as `@effect/ai-openai` when API billing is chosen. Do not use v3 API patterns.
- Herdr and its SDK both declare protocol 22; their pinned API schema JSON values match. Live compatibility and readiness still need testing.
- Herdr can keep specialist sessions alive across client detach. Native agent session files are needed for supported restart/resume behavior. Explicit finding history remains necessary.
- Plannotator has a direct strict Markdown gate with machine-readable approval/revision/dismissal outcomes. It can wait without model calls. This is a better initial candidate than a host hook that automatically proceeds into implementation.
- SQLite-backed Durable Objects fit per-task status, findings, pending questions, and routing. An inbound devbox-to-DO WebSocket can use hibernation. Persist the records; sockets and fibers are not the database.

## Long waits need a transport decision

The user's preferred behavior is still the target: the operator delegates, then consumes no model calls while waiting, even for hours.

Two mechanisms can meet that behavior:

1. A local Effect tool awaits Herdr or Plannotator and returns when work settles. Herdr's SDK request deadline and the server wait deadline are separate. Codex MCP defaults to 60 seconds per tool but exposes configurable `tool_timeout_sec`; the default is not a hard maximum. Test the full chain at the intended duration.
2. The operator records what it is waiting for and ends its turn. A runtime observer delivers the eventual result into the same persisted operator thread. This avoids relying on one open tool request and still does not poll the model. The runtime delivers an event; the agent decides what to do with it.

The second is a recovery-friendly proposal, not an approved replacement for the first. Neither mechanism survives lost process/session storage automatically. Full autonomous crash recovery remains outside the initial scope, but reconnects, duplicate messages, and ambiguous submissions still require explicit handling.

## Approval must refer to exact plan bytes

Recommended first candidate: `plannotator annotate <plan.md> --gate --json --require-approval --result-file <new-path>` in a supervised, task-scoped process.

The strict result distinguishes approve, annotations, dismissal, and failure. It does not include the approved Markdown or a plan hash. Bridle must freeze a revision, associate the human decision with that revision, persist the Markdown, and return it to the operator without starting implementation inside the planner.

The proposed public gateway needs to enforce expiry and task/revision scope on the full review session, not only the HTML page. It must not expose filesystem browsing, optional terminals, Herdr's socket, or operator control endpoints. A planner with unrestricted access to Plannotator's local unauthenticated endpoint can approve its own plan; gateway-attested decisions or a separate trust boundary are needed if human approval is to be enforced rather than merely prompted.

Native Plannotator integrations differ. For example, Pi's external handoff exists, but the pinned extension has a missing-UI/assets auto-approval fallback. That is not an acceptable fallback for Bridle. This does not mean Bridle must choose Pi or modify it; use the direct gate first and evaluate the chosen coding-agent host separately.

## Candidate deployment, not yet an approved plan

```text
Input adapters
    → Cloudflare Worker
    → task Durable Object
        → Namespace lifecycle adapter
            → task dev box
                → AI operator + Effect tools
                → Herdr specialist sessions
                → project services and QA
                → Plannotator review process
        ← authenticated status/results/questions from dev box
        → originating conversation

Human → Bridle secret-link gateway → private review process
Artifacts → durable storage independent of dev-box deletion
```

`Namespace lifecycle adapter` may be a Worker-compatible HTTP service implementation or a separate Node process. The gateway's transport into Namespace is also unselected. Those are real infra decisions, not details to hide in a generic `DevboxService` interface.

If Codex is the operator, it owns the model loop and calls Effect-backed MCP tools or experimental app-server dynamic tools. With an Effect `LanguageModel`, Bridle owns that multi-turn driver. The latter can target the ordinary API or an Erudane-style OAuth-configured Codex backend, subject to validation. A custom full `LanguageModel` bridge is not automatically required. No option has been selected by the user yet.

Credential isolation matters in either design. A task VM's default workload token may be broader than one task. A GitHub token that can merge undermines the no-merge rule even when no merge tool exists. Keep infrastructure credentials away from repository-controlled processes and enforce repository restrictions outside prompts where possible.

## Validation order

See [validation plan](validation-plan.md) for acceptance criteria. Start with these dependencies before designing a full implementation backlog:

1. Select the intended OpenAI identity/billing model and operator integration candidate.
2. Resolve installable Effect/Herdr/Namespace package and runtime versions.
3. Validate one Namespace provisioning/bootstrap path and explicit active-task lifetime.
4. Validate one Herdr agent turn and a revision-tagged result, then a long wait and reconnect.
5. Validate an exact-byte, secret-link Plannotator approval round trip.
6. Join the pieces into one small task with a real finding/fix/re-review cycle and human handoff.

Local mock tests can proceed without credentials once authorized. Live tests need an agreed workspace, credential grants, cloud-spend budget, and cleanup policy. None has been run yet.

## Remaining decisions

Research surfaced three architecture choices that should be answered before the detailed service plan:

- Is subscription preference about avoiding Platform API billing, or about fixed-price included usage only? Which legitimate team automation identity should Bridle use?
- Should we adapt Erudane's existing OAuth/client layer for the desired Effect-native operator, or choose Codex calling Effect-backed tools? API billing is a separate alternative, not a prerequisite for an Effect-native loop.
- Should the first prototype keep dev boxes running throughout human review, or invest immediately in stop/resume-safe review sessions? Token lifetime and compute budget must agree with that choice.

The first input adapter, representative repository, final code-review channel, retention, limits, and one-versus-multiple repositories per task remain product choices from [CONTEXT.md](../../CONTEXT.md). They do not prevent source research, but a precise implementation plan must state its assumptions rather than silently pick them.

## Detailed reports

- [Effect v4 APIs and operator/tool boundaries](effect-v4.md)
- [Herdr sessions and Plannotator approval](herdr-plannotator.md)
- [Namespace lifecycle, SDK, authentication, and ingress](namespace.md)
- [OpenAI subscriptions, Codex automation, and team identity](openai-auth.md)
- [Correction: Erudane's existing subscription-backed Effect provider](erudane-auth.md)
- [Cloudflare storage, routing, hibernation, and alarms](cloudflare.md)
- [Source inventory](sources.md)

## Checks performed

- Initialized Git, committed the bootstrap, and imported five squashed subtrees.
- Compared each subtree's Git tree against the recorded upstream revision: all matched.
- Compared parsed Herdr and SDK API schemas: equal, protocol 22.
- Inspected source, manifests, example/test bodies, official documentation, and selected public npm metadata/archives. Reading an upstream test is not running it.
- No deployment, paid API call, credential access, dependency installation, upstream installer execution, or live agent/browser test.

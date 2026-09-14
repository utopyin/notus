# Slack devbox provisioning

Authorized follow-up to [devbox validation](../research/devbox-results.md). The user chose to keep the devbox assigned after readiness and include safe wake-up handling. Model execution and repository checkout remain disabled. Simulation stays available, and existing tasks keep their persisted mode.

## Scope

An authorized mention in the dedicated test channel creates one task-level execution attempt, captures the workspace environment, provisions one Namespace devbox, and reports authenticated native Herdr readiness through the existing Slack outbox. Readiness means no model or repository work ran. The box remains assigned and may auto-sleep under Namespace policy.

This slice does not grant model access, introduce automatic replacement, implement agent-session restoration, or deploy to production. Deployment of the new mode requires explicit configuration and a dedicated provider automation credential. Do not reuse a short-lived personal login as a permanent Worker credential.

## Ownership

- Tasks keeps the immutable origin, persisted task mode, inputs, answer obligations, status responses and delivery receipts.
- Executions owns the active attempt, captured environment, provisioning operation, resource assignment, runtime epochs and accepted readiness. No second current-attempt pointer belongs in Tasks.
- Workspaces continues to own the opaque environment shape. Select its revision when the attempt is durably initialized; a crash before that commit may select a newer revision. Afterward, retries use the captured snapshot.
- Control coordinates replayable handoffs and provider work. Apps own bindings, HTTP, local DO gates and alarms.
- Namespace alone validates native settings and adds trusted startup configuration. Keep reserved session/environment guards. Shared storage neither extracts native fields nor translates a generic machine model.
- The devbox supervisor owns local readiness and its narrow callback client. Herdr receives neither the callback credential nor Namespace control authority.

## Durable launch

Persist the attempt, immutable configuration, stable operation/name and launch-contract version before sending Create. Claim local work under a short gate, call Namespace outside it, then record the fenced result under the gate. Recovery wakes must survive interruption at every boundary.

A lost Create response is ambiguous, not permission to send another Create. Reconcile the same name and operation. A single not-found response does not prove non-creation; unresolved ambiguity blocks automatic replacement. Persist resource identity before activation. Keep remote-operation claims separate from attempt generations and runtime epochs.

Permit only explicitly approved native configuration in this experiment. In particular, reject checkout, extra startup commands, model integrations, privilege escalation and unapproved executable images rather than silently dropping them. The provider performs those checks; the domain still stores the original JSON.

## Readiness and wake-up

Use a dedicated authenticated callback, not generic outcome submission. Its capability binds the workspace, task, attempt, generation, launch operation and assigned resource. Readiness observations additionally bind a control-authorized runtime epoch, run identity and challenge. Identical retries acknowledge the original durable receipt; conflicting or stale observations cannot replace current readiness.

Recoverable enrollment must work after sleeping without making a short-lived bearer the task's lifetime. Keep recovery authority revocable with the assignment, persist enrollment transitions, and allow an old credential to recover only its already-committed transition. No callback may choose a Slack destination, inject arbitrary answer text, or authorize models. Capability possession is not hardware attestation.

Keep local ownership separate from remote authority. A free file lock, missing PID, timeout or failed ping does not prove that an old Herdr process tree is gone. Recovery must distinguish a verified new VM boot from a same-kernel orphan. Do not signal recorded PIDs from a previous boot or blindly delete stale ownership. Same-kernel recovery without sufficient teardown evidence remains an explicit blocked state, not a weaker fallback. Validate the actual Namespace stop/wake behavior before enabling this mode.

Follow-ups must not create another box. The initiating actor may request wake-up of the existing assignment; other thread participants can receive status without acquiring lifecycle authority. Responses describe observed readiness and its time, not continuous health. Replacement after provider expiry or unresolved recovery remains explicit intervention in this slice.

## Credentials and enablement

Namespace control uses a dedicated, tenant-scoped, revocable automation token supplied through Alchemy's `Config.redacted` secret-binding mechanism. Its grants, expiry and rotation owner must be recorded privately without the bearer. Confirm the provider's permission mapping rather than guessing or granting unrestricted access. Callback signing uses a separate key. Neither enters reusable configuration, snapshots, images or logs.

An early Create returned HTTP 429 and was recorded as a one-devbox account limit. The user later clarified that the account limit is an aggregate CPU budget and that multiple devboxes can exist; treat the earlier reading as unverified. A live Create on 2026-09-14 hit the same account limit with 429; a later Create succeeded. Respect the budget; do not change quotas. Existing unrelated resources remain untouched. No ongoing Slack-triggered spend is enabled merely by adding code or generating migrations.

## Validation

- Preserve zero lint diagnostics, uncached workspace/root typechecks, existing simulation assertions and generated migration ownership. Add only newly generated migrations; do not edit earlier SQL or add manual NULL guards.
- Native workerd/D1/DO tests cover mode persistence, immutable configuration, durable intent, claim interruption, ambiguous Create, resource identity, readiness authentication/replay, epoch fencing and answer obligations.
- Offline Linux tests cover concurrent starts, all existing signal/descendant cleanup cases, stranded ownership, stale sockets, enrollment retries and supported boot recovery. No repository test files by default.
- Rebuild and publish an allowlisted image context, then validate initial readiness and a real stop/wake cycle in isolated named resources. Keep models and checkout off.
- Enable the dedicated Slack path only after its deployment credentials and live-test plan are approved. Retained test assignments and cleanup responsibilities must be explicit.

This document records the slice and its safety requirements. Concrete recovery and enrollment protocols remain under implementation review; no live enablement or successful Slack-to-devbox round trip is claimed yet.

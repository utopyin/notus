# Intake validation results

Implementation and verification of the authorized [source round trip](../plans/intake.md). This document records evidence, not additional product requirements.

## Current status

The test Worker now runs in operator mode for new tasks with the explicitly selected Platform API key backend. On 2026-09-14 a live operator task `<task-id>` received three thread inputs; each produced one completed step, one accepted outcome with model-written text, and confirmed reaction and answer deliveries, read through the private snapshot RPC. A later task asked for a dev box: the operator's `create_devbox` call led to Namespace devbox `gd7ue6v36adnm` being created, activated and reported ready, and the model answered with the readiness result. After the command channel and image version 2 were deployed, a new task's second input produced a three-round turn: `create_devbox`, then `run_command` served by the box's own supervisor poll two seconds after readiness, then an answer quoting the box's kernel and CPU from real output, on devbox `bnk1q4onp0se6`. With the GitHub App deployed, a further task created devbox `l879m39ao36u2`, checked out the private repository `<owner>/<repo>` read-only, and answered with a HEAD commit that matched GitHub's `main`. On image version 6, task `58f8c20e` checked out the repository, edited the README through commands, pushed `utopyin/polish-readme-documentation` as Notus, and after the pull-request token fix opened [<owner>/<repo>#1](https://github.com/<owner>/<repo>/pull/1) into `main`. Two earlier tasks under the subscription backend received only the operator's fallback answer; see the [OpenAI live findings](openai-auth.md#live-findings-2026-09-14). Readiness and simulation tasks keep their persisted modes and the retained devbox is unaffected.

The dedicated Notus Slack test Worker also provisions retained Namespace devboxes and reports authenticated native Herdr readiness. The user confirmed a successful real Slack test on devbox `94cpdvujqgg92`, then confirmed warm and cold wake in the same thread. This deployed round-trip evidence is user-reported; the isolated live lifecycle and native-workerd checks are recorded separately in [Namespace evidence](namespace.md#readiness-automation-probe-2026-09-13).

The deployment uses workspace environment revision 1 and the approved callback-enabled image. New tasks select readiness mode; existing simulation tasks keep their persisted mode. The preparation deployment kept simulation selected while migrations and workspace configuration were applied. A subsequent forced test-stage deployment applied the readiness configuration because an ordinary Alchemy plan did not detect the changed secret-backed mode value. Only the existing test Worker and D1 resource were updated. No models, repository execution, or production deployment are enabled.

The earlier round trips below were recorded under the former Bridle name and remain historical evidence.

## Rename verification

The rename covers the repository directory, package scopes, imports, service IDs, configuration keys, project documentation, and the Alchemy stack. The credentials profile moved to `notus-simulation`; existing Slack credentials and immutable IDs were retained. The local Slack manifest uses `Notus Simulation`, but no live Slack app settings or channel names were changed by this rename.

All 74 local checks passed against audited `@notus` source and unpatched Effect. Evidence and commands are in `/tmp/notus-rename-yoTcGE/REPORT-notus.md`. All ten workspace typechecks and the root check passed.

The new Worker initially returned hostname-level 404s, then passed `/health` 200, `/debug` 404, unsigned ingress 401, signed challenge 200 with the expected challenge, and signed malformed JSON 400 without code changes. Read-only D1 inspection confirmed the existing migration applied to the new database and an empty intake queue. No Slack round trip has been run against this fresh stack.

The user authorized retiring the old simulation without migration. Alchemy deleted the former Worker `bridle-api-simulation-<suffix>` and D1 database `Bridle-SharedDatabase-simulation-<suffix>`, ID `2fc16053-4ed3-4f44-b152-75c71f821aa4`, and removed their bindings. The shared Alchemy state store and unrelated profiles/resources were retained. The earlier task records were not copied to Notus.

## Historical validation before the rename

- `bun run check:types` passed across all ten workspaces and the root stack, including after review fixes.
- Follow-up temporary validation passed 32 workerd checks, 19 mock Slack-provider checks, and 23 focused native D1 intake checks. These cover the recovery, claim timing, provider timeout, early-participant, and execution-ownership fixes. Reports are in `/tmp/bridle-review-fixes/REPORT.md`, `/tmp/bridle-slack-check/check.ts`, and `/tmp/bridle-inbox-6GMmPg/REPORT.md`.
- A second read-only review found no new concrete P1/P2 issue. It did not establish deployed runtime behavior.
- Final native revalidation passed all 32 checks with zero unexpected outbound calls. All ten workspace typechecks and the root check passed. Focused formatting passed on 38 files. Oxlint exited successfully with 75 warnings and zero errors, so this is not a warning-free lint result.
- Temporary native Miniflare validation passed 23 checks with actual D1, SQLite-backed Durable Objects, Effect SQL drivers, and application domain services. Coverage included concurrent source reservation, lost bootstrap acknowledgement recovery, dedupe, restart reconstruction, automatic alarms, expired delivery ambiguity, reaction independence, conflicting results, and synchronous rollback.
- That run used Miniflare `4.20260730.0` and workerd `1.20260730.1`. Its wrapper replaced Slack and did not execute Alchemy-generated app startup, public ingress, the production alarm method, migration ledger, or real cron dispatch. These remain separate verification obligations.
- Temporary evidence is at `/tmp/bridle-workerd-yc0CjH/REPORT.md` and `results.log`. It is machine-local and not a committed regression suite. Rerun with `bun run build.ts` then `node run.mjs` in that directory, adapting the wrapper if service interfaces change.
- Alchemy deployed the API Worker, shared D1, Task binding, and minute cron using the isolated `bridle-simulation` profile.
- Deployed checks returned `/health` 200, unsigned `/slack/events` 401, `/debug` 404, signed challenge 200, and signed malformed JSON 400.
- Read-only D1 inspection confirmed migration `20260913003233_loose_thor_girl` in Alchemy's ledger. All inspection queries reported zero rows written.
- Slack settings were reloaded and confirmed the verified endpoint with saved `app_mention` and `message.channels` subscriptions.
- Human mention `1789261676.867979` was posted in the dedicated test channel. Slack history confirms the actual bot mention. D1 records `startIntent=1` and a provisioned initiator.
- After the runtime-context fix, the minute drain recovered that original input without reposting. D1 shows one completed intake row and one initialized route. Slack confirms the bot's `eyes` reaction and answer `1789262247.506599` in thread `1789261676.867979`. The answer explicitly states that no coding agent ran.
- Human thread follow-up `1789262059.159009` was posted before recovery, without a new mention or channel broadcast. The next minute drain delivered its answer `1789262308.514969` in the same thread, with its own `eyes` reaction. Both intake rows are `done`, each with one forwarding attempt and no stored error. There is exactly one initialized route, for task `3da4236d-b62b-427e-b2d6-5b6a138904d3`.

## Unpatched rc.112 verification

The dependency change removed the Effect patch and left Alchemy and Drizzle versions unchanged. `bun install --frozen-lockfile --ignore-scripts` succeeded without changes. Typechecks passed across all ten workspaces and the root stack.

- All 74 local checks passed again: 32 native durability, 23 native intake, and 19 mock Slack-provider checks, with zero unexpected outbound calls. Bundle audits verified actual rc.112 source paths and rejected rc.115 paths. Evidence and rerun commands are in `/tmp/bridle-review-fixes/REPORT-rc112.md`. Native checks passed with both the original workerd and the currently installed `1.20260901.1` binary.
- Alchemy CLI help, simulation plan, and deployment passed without the Effect patch. The deployment updated only the existing API Worker; database, cron, and Task bindings remained unchanged.
- Normal `alchemy logs --tail` streamed `inbox.drain` logs without the prior Socket error. Observation stopped with SIGINT after 90 seconds, yielding expected exit 130. The private local log is `/tmp/bridle-rc112-tail.log`.
- Deployed health, missing debug route, unsigned rejection, signed challenge, and signed malformed-JSON checks retained their expected statuses.
- Human follow-up `1789285365.177979` received an `eyes` reaction and answer `1789285369.568529`, about 4.4 seconds later, in the original thread. D1 shows three completed inputs, one forwarding attempt each, no stored errors, and the original task route.

## Private persisted state

Before the rename, a fixed-task ephemeral preview called the former Worker's private `snapshot` RPC after the unpatched redeployment and follow-up. No public debug route or permanent inspection Worker was added. Schema validation confirmed:

- One simulation task with three inputs and three fulfilled answer obligations, none pending.
- One active simulation attempt, three invocations, and three accepted results.
- Three responses and six confirmed deliveries, each with a matching persisted receipt.
- Reaction receipts match the three input timestamps; answer receipts match `1789262247.506599`, `1789262308.514969`, and `1789285369.568529` observed through Slack.

At that inspection, the attempt remained active because answering inputs does not close the task. Temporary sanitized evidence is in `.alchemy/inspection/REPORT-rc112.md`, with the earlier two-input snapshot preserved in `REPORT.md`. `.alchemy/inspection/receipts-rc112.ts` fixes the account, Worker, method, and task rather than accepting arbitrary RPCs. The optional preview-token exchange returned 400; Alchemy's documented fallback to its original session token succeeded. No credentials or unrestricted snapshot payload were printed.

## Compatibility repairs

The initial simulation used an Effect compatibility patch. It has been removed in favor of the unpatched Effect release selected in `package.json`, aligned with the published Alchemy and Distilled packages. Platform and SQL packages move together; root overrides prevent transitive Effect packages from selecting a newer release. An explicit Vitest development dependency satisfies the selected `@effect/vitest` peer. Application configuration now uses that release's `Config.redacted` constructor. Root `mime` still supplies an undeclared import in Alchemy's Cloudflare runtime.

The first deployment exposed a migration path problem. Resource properties also evaluate inside workerd, where `import.meta.url` is not a file URL. `apps/api/src/database.ts` now passes the repository-root-relative migration path to Alchemy. Deploy from the repository root.

Under the initial Effect release, Alchemy CLI tail failed because the Socket `runRaw` API had been removed. Temporary ignored inspection tooling used a native WebSocket and created/deleted only this Worker's ephemeral tail. The replacement Effect release retains `runRaw`; normal CLI tail now works without a patch.

The first live input exposed another app integration problem. The drain requested `RuntimeContext` during an event, but Alchemy provides it privately during initialization. The resulting defect prevented the first claim, and Alchemy's cron wrapper returned success after catching the cause. The app now captures `CurrentRuntimeContext` during initialization, fails explicitly if absent, and supplies it to Task RPC calls. Temporary probes in `.alchemy/inspection/runtime-probe.ts` and `drain-probe.ts` reproduce the missing service and check the repaired capture. Typechecks and redeployment passed; the original pending input then completed. A focused source review and additional temporary probes found no correctness issue in the captured context's lifetime or private snapshot RPC. The drain now also logs otherwise-unhandled defects before Alchemy's cron wrapper can catch them. Final deployment and health/signature checks passed.

## Isolated setup

The user manages the Slack app in Inboxapp.com. Existing app, bot, and dedicated test-channel IDs remain configured; display-name changes do not require replacing those IDs. Scopes remain limited to mentions, public-channel history, message posting, and reactions. No teammate invitations or unrelated-channel messages are part of the rename.

Cloudflare uses Utopy's account through the separate `notus-simulation` Alchemy profile. It does not use Inbox's Cloudflare account or replace the existing default profile.

Local credentials and fixture identifiers live in ignored `.env.simulation` with mode `0600`. Do not print or commit that file. Worker configuration uses Alchemy-captured Config bindings, with redacted Slack secrets. Fixture seeding is private runtime configuration, not a public registration endpoint or model authorization grant.

Plan explicitly with:

```sh
bunx --no-install alchemy plan --stage simulation --profile notus-simulation --env-file .env.simulation --no-input
```

Do not use root production-oriented scripts for this slice. The stack rejects stages other than `simulation`.

Configure Slack Event Subscriptions with `https://notus-api-simulation-<suffix>.<account>.workers.dev/slack/events` and both `app_mention` and `message.channels`. The signed challenge is verified from the client side; saving this URL in Slack is left to the user. OAuth scopes alone do not subscribe the app. Keep the channel/team allowlist unchanged during testing.

Deployed resources:

- Worker `notus-api-simulation-<suffix>`.
- URL `https://notus-api-simulation-<suffix>.<account>.workers.dev`.
- D1 `Notus-SharedDatabase-simulation-<suffix>`, ID `2196489a-a870-46a4-879a-c911a6edba83`.
- Slack app `<slack-app-id>`, team `<slack-team-id>`, channel `<slack-channel-id>`.

## Remaining evidence

The historical live round trip and persisted receipts were verified before the rename. These limits remain:

- The fresh Notus deployment awaits the user's Slack subscription update and a new live mention.

- Deployed alarm retry after injected provider/runtime failure was not tested. Local failure injection and successful live alarms are separate evidence.
- The successful live recovery used minute cron after redeployment. No timing claim is made for the best-effort immediate kick.
- Temporary validation programs are machine-local, not a committed regression suite.
- Task reconciliation scans history without pagination. This slice does not establish large-history performance or real execution-provider compatibility.

## Cleanup

The new Notus simulation remains deployed. All historical local tail processes have stopped. One earlier tail deletion failed; other completed inspection tails reported cleanup. Historical snapshot previews had no keepalive and no explicit delete API. Their individual expiry was not verified before the former Worker was retired.

To retire it, first disable this app's Slack Event Subscriptions, then inspect and destroy only the `simulation` stack using profile `notus-simulation`. Do not use the root production-oriented script or remove the shared Alchemy state store, other profiles, or unrelated account resources.

```sh
bunx --no-install alchemy destroy --stage simulation --profile notus-simulation --env-file .env.simulation --no-input
```

Slack app/channel cleanup is owned by the user. Retire only the dedicated simulation resources and remove their private local configuration when no longer needed. The new Notus stack has not been destroyed.

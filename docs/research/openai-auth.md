# OpenAI authentication for Bridle

Research date: 2026-09-12 UTC. Status: research, not an implementation decision.

## Conclusion

**Subscription-backed Bridle is technically plausible if Codex itself is the AI operator. A ChatGPT subscription is not a credential or billing plan for arbitrary OpenAI API calls.** Effect can implement the operator's tools and durable coordination without using Effect's OpenAI model provider.

The strongest current evidence is more permissive about automation than older advice suggests:

- OpenAI documents subscription sign-in, headless login, SDK scripting, and a constrained CI workflow using Codex-managed authentication. [S2, S3, S5, S6]
- Codex access tokens explicitly support trusted CLI and app-server automation in ChatGPT Business and Enterprise workspaces. They represent a workspace user, not a general API identity. [S7]
- Workspace service accounts explicitly support shared integrations and unattended workflows without an employee's account. **They are available only on pay-as-you-go plans**, so they do not establish a fixed-price, subscription-only team solution. [S8]
- Codex app-server exposes custom tool callbacks, but these are experimental. Codex can instead call an Effect-backed MCP server using documented MCP support. Neither is a drop-in replacement for the Responses API. [S4, S10]

The unresolved product question is whether "subscriptions for all AI" means no Platform API billing, or strictly fixed recurring cost without metered credits. Those are different constraints. Codex workspace automation may satisfy the first while failing the second.

### Feasible choices

| Choice | Evidence and feasibility | Blocker or trade-off |
| --- | --- | --- |
| Codex operator and Codex workers, with each human using their own subscription identity | Documented login and scripting mechanisms. Effect tools exposed through MCP, or experimental app-server dynamic tools. | Pilot candidate, not proof that a multi-user conversation may consume one person's allowance. Do not pool personal accounts or copy one refresh-token lineage across parallel devboxes. |
| Business or Enterprise workflow-owner Codex access token | Explicitly documented for trusted automation, including app-server. No browser login needed for each job. | Confirm workspace availability, whose entitlement pays, and whether Bridle's shared-team workload fits that member-owned identity. Token creation does not create another seat or more allowance. |
| Workspace service account, optionally using workload identity federation | Official non-human identity for shared integrations. Best identity model for a team service. | Service accounts require pay-as-you-go. Federation is beta, requires workspace enablement, and does not change billing. |
| API-backed Effect operator, subscription-backed Codex workers | Direct Effect OpenAI calls use the documented API model. Worker subscription login is independent. | Does not meet subscription-only AI. Shared workers still need a legitimate identity model. |
| API-backed operator and workers | OpenAI recommends API keys for general CI/shared automation. | Metered API billing rather than subscription usage. |

Recommendation: evaluate Codex as the operator with Effect tools before designing any provider adapter. For a shared production service, settle the workspace identity and billing agreement first. Do not promise unlimited parallel agents for a flat subscription fee.

## Evidence and scope

This report used web search, scraped primary OpenAI documentation, followed authentication, SDK, MCP, pricing, and legal links, and read pinned Effect source. No model requests, login attempts, credential inspection, installations, or runtime tests were performed. No support or sales confirmation was obtained.

The old `developers.openai.com/codex/auth`, `/sdk`, `/app-server`, and `/mcp` URLs redirected to OpenAI's `learn.chatgpt.com` documentation. Sources below record the destination URLs. Most pages expose no revision or absolute update date. Retrieval date is not a claim about when a feature launched. Some scraper responses used caches dated September 11 or 12, 2026.

Terminology in this report:

- **Documented** means an official page describes the mechanism. It does not mean Bridle has tested it or that OpenAI promises production support.
- **Source-verified** means inspected source establishes the stated implementation behavior.
- **Proposal** means a Bridle design that still needs approval and testing.
- **Unknown** means the reviewed sources do not settle availability, commercial permission, or operational behavior.

## Billing and the Effect boundary

### Subscription access is product-specific

ChatGPT and the API platform have separate billing systems. API usage is billed separately from ChatGPT subscriptions. Codex distinguishes "Sign in with ChatGPT for subscription access" from API-key usage at standard API rates. Buying a subscription or Codex credits does not fund arbitrary Platform API calls. [S1, S2]

The current Codex help page says Codex is included across ChatGPT plans, including Free and Go, with plan-dependent limits. It also says Codex, ChatGPT Work, ChatGPT for Excel, and Workspace Agents share allowance and credits where available. Subscription access is therefore neither unlimited nor reserved solely for Bridle. Local specialist reviews count toward general Codex usage; the separate Code Review usage category applies to GitHub Codex reviews. [S3, S11]

Business flexible pricing starts with per-seat limits and uses optional purchased workspace credits after those limits. Enterprise/Edu flexible pricing uses a contract-level shared pool; the order form controls its allocation and overages. Pooling purchased workspace credits is documented. Pooling personal subscriptions is not the same arrangement. [S20]

Use the account's actual usage dashboard and `account/rateLimits/read`, not a hard-coded estimate of messages per subscription. Pricing estimates depend on model, context, reasoning, tools, caching, and task duration. Five-hour windows and weekly limits can apply. The docs allow an active turn to continue after a limit is reached, subject to fair use. That is not an entitlement to keep a turn open indefinitely. [S3, S4, S11]

### Arbitrary Effect OpenAI calls cannot use the subscription as documented API auth

Local evidence:

- `repos/effect/packages/effect/package.json` and `repos/effect/packages/ai/openai/package.json` are version `4.0.0-rc.115`.
- The core package exports `effect/unstable/ai`; the OpenAI provider is the separate package `@effect/ai-openai`.
- `OpenAiClient.ts` defines `apiKey`, `apiUrl`, organization/project headers, and HTTP transformations. It defaults to `https://api.openai.com/v1`, applies bearer authentication, and calls `/responses` and `/embeddings`. Its WebSocket mode also targets Responses, not Codex app-server.
- The pinned AI examples configure `OPENAI_API_KEY` through the OpenAI provider. [L1]

Being able to set an arbitrary URL or bearer string is a transport capability, not an OpenAI subscription entitlement. OpenAI explicitly says Codex access tokens are for Codex automation and general OpenAI API calls require Platform API keys. Codex's externally managed ChatGPT-token mode is an app-server integration feature, not a public subscription-backed Responses API. [S2, S4, S7]

Therefore:

1. Ordinary `LanguageModel` calls through `@effect/ai-openai` remain API-billed.
2. A custom Effect service may drive the official Codex CLI, SDK, or app-server and execute typed tools. That changes the agent runtime; it does not add subscription authentication to `OpenAiClient`.
3. A custom `LanguageModel` adapter around Codex is conceivable, but no official OpenAI/Effect adapter was found. It would have to translate thread state, built-in tools, approvals, streaming, errors, structured output, and cancellation. Do not advertise general API compatibility or assume embeddings and every API model are available.
4. Do not extract ChatGPT tokens for direct model requests, call undocumented ChatGPT endpoints, or build a refresh-token client outside Codex.

## Supported authentication paths and remote devboxes

### CLI and TypeScript SDK

The CLI supports managed ChatGPT browser login through `codex login`. `codex exec` reuses saved CLI authentication by default. The TypeScript SDK wraps the CLI, exchanges JSONL events, supports streaming and structured output, and resumes persisted threads. OpenAI recommends the SDK for coding automation and app-server for rich custom clients. [S2, S5, S6, S12]

For a Namespace devbox, authentication belongs on the machine that runs Codex. A login on the developer's laptop is not automatically available inside the box. Proposed setup choices, not executed here:

- Prefer `codex login --device-auth` for a human-owned remote session. Device-code login is beta and must be enabled in personal security settings or workspace permissions. The user completes the browser ceremony privately.
- If device-code login is unavailable, OpenAI documents forwarding the browser callback with SSH, using local port `1455` by default.
- OpenAI also documents copying the account owner's auth cache to a trusted headless machine. This is a fallback for that owner's session, not permission to share personal credentials with teammates. Avoid it as Bridle's team provisioning design.
- For trusted Business/Enterprise automation, use an admin-authorized Codex access token rather than inventing unattended browser login.
- Where enabled, workload identity removes the stored long-lived OpenAI credential. Namespace token issuance and protected-file rotation have not been verified. [S2, S7, S9]

The SDK inherits its parent environment by default and accepts an explicit environment. Its `apiKey` option supplies `CODEX_API_KEY`. A subscription-only process should not accidentally inherit API credentials or an SDK API-key option. Check the selected auth mode rather than assuming billing from the presence of a ChatGPT login. [S9, S12]

### App-server authentication

App-server documents these relevant account flows:

| Flow | What OpenAI documents | Bridle consequence |
| --- | --- | --- |
| Managed ChatGPT browser/device code | `account/login/start` with `chatgpt` or `chatgptDeviceCode`; completion events; Codex persists and refreshes credentials | Prefer Codex-owned login lifecycle for human-owned sessions. |
| API key | `account/login/start` with `apiKey` | Separate API billing. |
| Codex access token | `CODEX_ACCESS_TOKEN`, or a persistent login from `codex login --with-access-token` | Explicit support for trusted app-server automation. Credential belongs on the server host. |
| Externally managed ChatGPT tokens | Experimental `chatgptAuthTokens`; host provides token and account ID and answers refresh requests | Not a reason to harvest browser tokens or impersonate an official OAuth client. Public registration/issuance for an independent Bridle auth client was not established. |
| Workload identity | Host-side federation configuration | Supported Codex integration, but beta and workspace-gated. |

Sources: [S4, S7, S9]. External-token refresh requests time out after about ten seconds. The CI auth-cache maintenance guide explicitly excludes this mode. Use managed auth unless Bridle has a separately established, supported reason to own that lifecycle. [S4, S13]

### Workspace automation identities

Codex access tokens are currently documented for Business and Enterprise. A member needs local Codex access and access-token permission. Tokens represent their creator's workspace identity and use that identity's access. Granting token-creation permission does not change seat type, workspace role, or local runtime permissions. Use finite expiry, secret storage, and rotation. Disabling local Codex permission suspends affected member tokens; restoring access can reactivate them. Revoke a token when access must end permanently. [S7]

A workspace service account is different. It is a non-human principal intended for CI runners, scheduled jobs, and shared integrations. Its tokens represent the service account, not their human creator. It has its own roles, groups, and plugin connections. OpenAI documents CLI `0.142.0` or later for its access tokens, and restricts service accounts to pay-as-you-go plans. Do not substitute an ordinary human seat with a made-up "bot employee" to evade that restriction. [S8]

Workload identity federation is beta, requires OpenAI enablement and Codex `0.148.0` or later, and maps a trusted OIDC or SPIFFE assertion to an existing workspace user or service account. It does not create membership during exchange. The runtime must keep a protected assertion file current. OpenAI tokens stay in memory and last no longer than one hour, bounded also by upstream assertion expiry and the federation rule. The docs cover CLI, TypeScript SDK, and app-server. This is an authentication improvement, not a billing conversion. [S9]

## Bridge for a Codex operator with Effect tools

### Proposal A: Codex calls an Effect-backed MCP server

This is the first integration to evaluate. Codex is the AI operator and chooses workflow actions. Effect validates and executes those actions, persists results, and delivers later events. Effect does not need to make its own model requests.

OpenAI documents local stdio and Streamable HTTP MCP servers, bearer/OAuth authentication, tool allow/deny lists, required-server startup, and per-tool approval settings. `codex exec` exposes MCP call events in its JSONL output. These are enough documented components to justify a small integration test, not evidence that the complete Bridle workflow already works. [S6, S10]

The MCP server would expose narrowly scoped operations such as starting a Herdr-managed agent, reading its status, storing findings, requesting plan review, and sending a task message. This is a proposed interface, not settled tool names. The tools should invoke Effect services rather than give Codex unrestricted access to workspace administration.

Keep the direction clear: Codex is the MCP **client** calling Bridle's tools. Current SDK docs say `codex mcp-server` and the standalone `codex-mcp-server` binary were removed. Old examples that run Codex as an MCP server are not the current recommended integration. [S5]

### Proposal B: app-server dynamic tools

App-server uses bidirectional JSON-RPC with the `jsonrpc` header omitted. Stdio is the default transport. A client initializes, starts or resumes a thread, starts turns, and consumes streamed events. The client can supply a per-turn `outputSchema`. [S4]

With experimental API opt-in, `thread/start.dynamicTools` registers client-implemented tools. When Codex calls one, app-server sends `item/tool/call`; the client executes the Effect handler and returns content and success status. Dynamic tools persist in rollout metadata and can be restored on resume. This is an explicitly documented bridge, but the fields and callback flow are experimental. OpenAI may change or remove experimental features. Pin the CLI and generate the protocol schema from that version before building against it. [S4, S14]

Limitations:

- Codex owns the model loop and conversation semantics. Bridle is not supplying a raw Responses request with arbitrary parameters.
- Built-in execution, filesystem operations, instructions, tools, and approval rules need deliberate restriction. A prompt saying "operator only" is not an access-control boundary. Verify that the chosen configuration can enforce the operator's intended tool set.
- Tool arguments and returned output still need Effect Schema validation, authorization, idempotency, and bounded size. JSON Schema alone does not authorize an action.
- OpenAI documents destructive app/connector approval prompts even when other hints are less privileged. Do not assume every connector can run unattended merely because shell approvals are disabled. Prefer Bridle-owned tools with explicit policy; test effective managed settings. [S4, S10]
- Documentation introduces app-server as a product integration interface, but also says, in its remote-host section, "The app-server command and WebSocket transport are experimental and aren't supported for production workloads." It repeatedly labels WebSocket experimental and unsupported while describing a stable protocol subset. Treat production support scope as unresolved; ask OpenAI rather than presenting this as an unconditional production guarantee. [S4]

Prefer a devbox-local stdio client for evaluation. It avoids exposing app-server directly to the Internet. If remote transport is later needed, OpenAI warns that non-loopback WebSocket listeners can allow unauthenticated connections by default during rollout. Configure separate transport authentication plus TLS or an SSH tunnel. Never reuse the upstream Codex access token as the app-server transport token. [S4, S7]

### Waiting hours on Herdr agents

A single hours-long awaited tool remains a candidate, not a verified integration. Codex's documented MCP tool timeout defaults to 60 seconds and is configurable through `tool_timeout_sec`. The default is not a hard maximum. Increasing it does not establish recovery after transport loss or devbox restart. App-server does not document a durable, indefinitely pending dynamic-tool callback contract. Test the user's preferred long-wait behavior on the chosen transport rather than declaring it impossible. [S4, S10]

A start-and-resume alternative avoids depending on one open tool call and still consumes no model calls while waiting. This is a proposal, not a change to the agreed product behavior:

1. The AI operator chooses to start work. An Effect tool records the request and returns a durable job ID promptly.
2. The operator records what it is waiting for and ends its turn. Herdr continues managing the coding-agent terminal session.
3. The task's Durable Object records status and routes structured updates to the originating conversation. A later completion event wakes the operator through a new turn on a resumed thread.
4. The AI operator evaluates the result and chooses review, QA, a fix round, a question, or final handoff. The scheduler delivers events; it does not decide the workflow.

Persist Bridle decisions, job IDs, deduplication keys, thread IDs, findings, and pending human questions independently of agent memory. Also preserve the Codex session files needed for resume. An ID alone does not recreate local history lost with an ephemeral devbox. App-server documents unloading an unsubscribed inactive thread after a 30-minute grace period; resume is the relevant mechanism, not an always-loaded thread assumption. [S4, S12]

Keep Bridle's existing human boundaries. Planning asks questions and returns approved Markdown through Plannotator without implementing. Routine implementation/review/QA/fix rounds have no routine human checkpoint. Humans perform final review and merge; no operator tool may merge. Authentication research does not change these requirements.

## Team access, concurrency, and credential handling

### Team access is not account sharing

OpenAI's account-sharing policy permits one person's account on multiple devices, not multiple people on one personal account. The Services Agreement prohibits shared account or individual login credentials between users, account resale/lease, and circumventing usage limits. Individual terms also prohibit making an account available to someone else. [S15, S16, S17]

ChatGPT-authenticated Codex follows workspace permissions and applicable Enterprise retention/residency controls. API-key use follows the API organization's settings instead. Business/Enterprise/Edu data is not used for training by default; personal Plus/Pro content may be unless the user opts out. Choose the account and data controls before sending private repositories. [S2, S3]

Giving coworkers access to the originating conversation must not automatically give them access to an employee's OpenAI credentials or private Codex history. Answering a task question is distinct from owning the model credential. For the shared team integration, use a documented workspace automation identity and establish the permitted initiating users and billing attribution. A shared Bridle workspace does not establish a shared OpenAI entitlement.

Member-owned access tokens are documented for trusted workflow automation. That does not settle whether one member's included subscription allowance may back every teammate's jobs. The service-account documentation gives a clearer shared-integration model, but requires pay-as-you-go. This is a commercial decision to resolve with OpenAI, not a limitation to bypass. [S7, S8]

### Concurrency has three separate limits

1. **Usage capacity.** Parallel operators and workers draw from applicable account/workspace allowance. More processes do not create more entitlement. No universal guaranteed concurrent Codex-session count was found in the reviewed primary docs. Obtain the account-specific limits and bound concurrency. [S3, S11]
2. **Managed-token refresh.** The advanced CI guide requires one machine or serialized job stream per `auth.json` copy. It explicitly says not to share the same file across concurrent jobs or multiple machines. Another process rotating the token can break refresh. Do not clone one auth snapshot into every Namespace task image. [S13]
3. **Runtime and transport.** App-server exposes multiple threads and rate-limit notifications, but that is not a throughput SLA. WIF shares one exchange/refresh session within a host process; separate processes exchange separately. With assertion replay protection, separate exchanges require fresh assertions with distinct `jti` values. Test intended concurrency rather than inferring it from a thread API or token's validity. [S4, S9]

A prototype using managed user auth should serialize its authenticated job stream. If parallel workers are required, select a documented automation identity strategy first. Separate `CODEX_HOME` directories prevent filesystem mixing but do not make copies of the same refresh credential independent.

### Credential recommendations

These are Bridle design recommendations informed by OpenAI's guidance, not changes made during this research:

- Scope credential references by workspace and principal now, with task-specific grants. Keep the shared prototype from becoming a global credential store.
- Keep OpenAI credentials on the trusted Codex host or in an approved secret manager. Keep them out of conversation messages, Plannotator links, Durable Object status payloads, prompts, repository files, terminal transcripts, and artifacts.
- Prefer a finite-lived automation token or enabled WIF for unattended work. A `CODEX_ACCESS_TOKEN` environment variable avoids saving a login but still needs process isolation; environment variables are not automatically safe from repository-controlled code.
- For managed login, Codex supports `file`, `keyring`, `auto`, and `ephemeral` credential storage. File storage is plaintext `auth.json` under `CODEX_HOME`; `auto` can fall back to plaintext and `keyring` fails if unavailable. A headless box must not assume a desktop keychain exists. [S2]
- Protect auth/session storage from code executed by agents. File permissions alone do not protect a secret from malicious code running as the same user. WIF docs explicitly require a protected directory outside tool-accessible paths, managed read denial, and a trusted refresh process. Apply equivalent threat analysis to other credentials. [S9]
- For the documented managed-cache CI fallback, persist Codex's refreshed cache rather than restoring an old seed every job. OpenAI describes refresh after roughly eight days in the current client and refresh/retry on `401`; this is implementation guidance, not a guaranteed session lifetime. The guide excludes public or open-source repositories and warns reauthentication may still be necessary. [S13]
- Prevent accidental API billing through environment allowlists, explicit auth checks, and approved fallback policy. Under a subscription-only policy, a quota/auth failure should pause and report, not silently switch to an API key.
- Revoke exposed tokens, rotate intentionally, and verify audit attribution. Service-account disable/delete revokes its tokens. Member local-access suspension is not equivalent to permanent revocation. [S7, S8]

## Licensing and support unknowns

The Codex source license is Apache-2.0. That permits use of the client under its license conditions; it does not grant hosted model access, subscription pooling, or an exemption from service terms. The current Service Terms require documented API use and note that generated code may carry third-party licenses. [S18, S19]

Both the rest-of-world and Europe individual Terms of Use contain a broad prohibition on automatically or programmatically extracting data or output. At the same time, Codex documentation explicitly describes SDK scripting and constrained ChatGPT-managed CI. This report does not resolve that legal interaction for a continuously running, multi-user orchestrator. It also does not interpret the broad clause as proof that OpenAI's documented Codex automation is categorically prohibited. For shared Bridle use, prefer business terms and obtain confirmation of the actual deployment. [S5, S13, S17, S21]

Questions still requiring an answer:

- Can Bridle's selected Business/Enterprise member-owned token run shared internal coding workflows against included seat allowance? Which users need seats, and how is concurrent operator/worker usage attributed?
- Which pay-as-you-go plan or order form enables service accounts, and can Bridle accept that billing model?
- Is the selected app-server version over local stdio supported for this production integration? What support applies to dynamic tools? OpenAI asks enterprise custom-client developers to identify their client and contact it for known-client registration. [S4]
- What are the actual concurrent-run, burst, and fair-use limits? No promised number was established here.
- Can Namespace provide and rotate the required OIDC/SPIFFE assertions for WIF? Is the workspace enrolled in the beta?
- Can the operator be restricted to the approved Effect tools without built-in actions bypassing Bridle's human-approval and no-merge rules?

Documentation discrepancies worth preserving:

- The auth overview discusses access tokens under Enterprise automation, while the dedicated access-token page explicitly includes Business. Prefer the specific page for research, but verify availability in the target workspace. [S2, S7]
- The pricing page still lists GPT-5.4 examples, while the Codex help article says ChatGPT-authenticated access to GPT-5.4 and mini ends on August 31, 2026. Discover available models with `model/list`; do not derive availability from stale price-table rows. [S3, S4, S11]
- App-server's custom-client positioning and stable API subset coexist with the production warning quoted above. Do not omit that warning from an architecture decision.

## Next minimal tests

None of these tests were run. Credential creation, login, spending, or configuration changes need separate authorization.

1. **Resolve the commercial gate first.** Ask OpenAI about the exact shared-team deployment, member-token allowance, service-account billing, concurrency, and app-server support. Record the reply and selected plan. A working token cannot answer these questions.
2. **One remote auth smoke test.** On one isolated Namespace box, with an authorized identity and a pinned CLI, verify the selected auth mode and workspace through documented status/account APIs. Make one short read-only Codex request. Compare usage attribution with the intended billing account. Do not print credentials. Verify no API-key fallback is configured.
3. **One operator/tool round trip.** Use a private fixture repository and one harmless Effect-backed MCP tool. Have Codex choose the tool and return a schema-constrained decision. Confirm argument validation, result handling, missing-tool failure, and that the operator cannot edit or merge. Test dynamic tools separately only if app-server's extra control is needed.
4. **An hours-later resume.** Return a fake durable job ID immediately, end the turn, restart the client, then deliver a completion event after at least two hours and resume by explicit thread ID. Check persisted history, routing to the original conversation, deduplication, and no duplicate job launch. Separately test devbox replacement with restored session storage.
5. **Small authorized concurrency and failure test.** After choosing the identity model, run two independent short threads without shared managed-auth cache races. Test cancellation, transport loss, revoked/expired test credentials, and an injected quota error. Verify pause/report behavior rather than silent API fallback. Do not exhaust a real subscription to test limit handling.
6. **Credential isolation check.** Use synthetic sentinel secrets, not production tokens, to verify repository tests, agent tools, MCP subprocesses, logs, screenshots, and artifacts cannot read or leak host credentials. For WIF, include assertion expiry and replay-protection behavior.

Passing these tests would establish a narrow pilot, not blanket licensing approval or unlimited subscription capacity.

## Source register

All sources accessed 2026-09-12 UTC unless a source revision is stated. "Updated N days ago" is the text shown during retrieval, not an independently verified publication date.

| ID | Primary source | Evidence/date |
| --- | --- | --- |
| S1 | [Managing billing for ChatGPT and the API platform](https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform) | Separate billing. Returned from the older subscription-to-API help URL. Displayed "Updated: 10 days ago". |
| S2 | [Authentication](https://learn.chatgpt.com/docs/auth) | Subscription/API distinction, headless login, storage, workspace restrictions, automation links. Redirect from `developers.openai.com/codex/auth`. |
| S3 | [Using Codex with your ChatGPT plan](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan) | Plan access, applicable terms, shared limits, training controls, model retirement. Displayed "Updated: 13 days ago". |
| S4 | [Codex app-server](https://learn.chatgpt.com/docs/app-server) | Protocol, dynamic tools, auth, rate limits, resume, transport warnings. Redirect from `developers.openai.com/codex/app-server`. |
| S5 | [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk) | Supported automation uses, TS/Python distinction, removal of Codex-as-MCP-server commands. Redirect from `developers.openai.com/codex/sdk`. |
| S6 | [Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode) | `exec`, cached auth, JSONL, structured output, resume, sandbox and credential warnings. |
| S7 | [Codex access tokens](https://learn.chatgpt.com/docs/enterprise/access-tokens) | Business/Enterprise trusted automation, permissions, expiry, app-server, no general API access. |
| S8 | [Workspace service accounts](https://learn.chatgpt.com/docs/enterprise/service-accounts) | Shared non-human workflows; pay-as-you-go only; CLI minimum `0.142.0`; lifecycle and audit. |
| S9 | [Codex workload identity federation](https://learn.chatgpt.com/docs/enterprise/workload-identity) | Beta enrollment, CLI minimum `0.148.0`, host boundary, refresh, precedence, concurrency, protected files. |
| S10 | [MCP](https://learn.chatgpt.com/docs/extend/mcp) | Codex as MCP client, transports, permissions, configurable `tool_timeout_sec` with a 60-second default. Redirect from `developers.openai.com/codex/mcp`. |
| S11 | [Pricing](https://learn.chatgpt.com/docs/pricing) | Shared allowance, variable capacity, credits, local review metering, API-key automation. Do not treat illustrative or stale model rows as availability guarantees. |
| S12 | [Pinned TypeScript SDK README](https://github.com/openai/codex/blob/53c542d944c705f3a66780a19223223bee57cbb6/sdk/typescript/README.md) | CLI wrapper, JSONL, streaming, sessions, environment. Remote HEAD observed with read-only `git ls-remote`; file's displayed last change `5ba12929f8870400695292eb805af440c25ec5ae`, 2026-08-16. This is a source pin, not a tested/recommended release. |
| S13 | [Maintain Codex account auth in CI/CD](https://learn.chatgpt.com/docs/auth/ci-cd-auth) | Explicit advanced managed-auth workflow, refresh persistence, serialized cache ownership, exclusion of public/open-source repos. Followed from S2/S6. |
| S14 | [Feature maturity](https://learn.chatgpt.com/docs/feature-maturity) | Experimental can change or disappear; stable means production support. |
| S15 | [Account sharing policy](https://help.openai.com/en/articles/10471989-openai-account-sharing-policy) | Individual account ownership, multiple devices not multiple users. Displayed "Updated: 11 days ago". |
| S16 | [OpenAI Services Agreement](https://openai.com/policies/services-agreement/) | Updated 2025-12-01, effective 2026-01-01. Sections 2.2, 3.1-3.3, 12.3; application integration, single-user accounts, limits, beta support. |
| S17 | [Individual Terms of Use](https://openai.com/policies/row-terms-of-use/) | Published/effective 2026-01-01. Account availability, programmatic extraction, rate-limit restrictions. Links separate EEA/Swiss/UK terms; deployment jurisdiction and signed agreements must be checked. |
| S18 | [Service Terms](https://openai.com/policies/service-terms/) | Updated 2026-09-10. Sections 1, 2, 4, 10; documented API use, beta terms, generated-code licensing, software/service distinction. |
| S19 | [Pinned Codex license](https://github.com/openai/codex/blob/53c542d944c705f3a66780a19223223bee57cbb6/LICENSE) | Apache-2.0 client license, not a hosted-service entitlement. |
| S20 | [Flexible workspace pricing](https://help.openai.com/en/articles/11487671-flexible-pricing-for-the-enterprise-edu-and-business-plans) | Business per-seat allowance and optional pooled credits; Enterprise/Edu contract pools and overages. Displayed "Updated: 42 minutes ago" in a response cached 2026-09-11, so no absolute update time inferred. |
| S21 | [Europe Terms of Use](https://openai.com/policies/eu-terms-of-use/) | Updated 2026-01-16; EEA/Swiss/UK individual terms, account-sharing and programmatic-extraction restrictions, business-use addendum. Followed from S17. |

### Local source revision

[L1] Effect subtree upstream revision `51d4a2f08a5c7691dc876415bc9fc0ecf467e153`, recorded in subtree squash commit `c38618d7d3f02771bb2788e5c9959e4d3bad06cc`. Read-only inspection included:

- `repos/effect/LLMS.md`
- `repos/effect/packages/effect/package.json`
- `repos/effect/packages/ai/openai/package.json`
- `repos/effect/packages/ai/openai/src/OpenAiClient.ts`, especially options and construction around lines 124-213, `/responses` at 242/294 and `/embeddings` at 315
- `repos/effect/ai-docs/src/71_ai/10_language-model.ts`
- `repos/effect/ai-docs/src/71_ai/20_tools.ts`

[Upstream OpenAiClient at the inspected revision](https://github.com/Effect-TS/effect/blob/51d4a2f08a5c7691dc876415bc9fc0ecf467e153/packages/ai/openai/src/OpenAiClient.ts). No vendored files were changed or imported into application code.

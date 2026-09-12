# OpenAI authentication evidence

This merges the former Erudane/Bridle correction with provider-auth research. [Sources](sources.md) owns revisions, version requirements, and observation dates. Official documentation establishes described mechanisms, not commercial approval or tested Bridle interoperability. No login, refresh, model request, or support confirmation was performed. Experiments belong in [validation](validation-plan.md).

## Local implementation evidence

Rechecked in this checkout:

- [`scripts/chatgpt/login.ts`](../../scripts/chatgpt/login.ts) implements authorization-code OAuth with PKCE, state checking, a loopback callback, code exchange, and persistence. It uses the Codex public-client identifier, not an independently registered Bridle client.
- [`scripts/chatgpt/token.ts`](../../scripts/chatgpt/token.ts) stores access/refresh tokens, expiry, and account ID; `fresh` renews within five minutes of expiry and saves the rotated pair. File creation requests mode `0600`, but this is plaintext development storage, not atomic distributed refresh ownership.
- Account-ID extraction decodes an unverified JWT claim. It is not authentication for incoming users or callbacks. Calling `fresh` is explicit, not a background renewal service. No production model runtime is present to demonstrate hours-long refresh.

Historical evidence retained, not reproduced:

The former correction reported `apps/api/src/model.ts` configuring `OpenAiLanguageModel` and `OpenAiClient` with `https://chatgpt.com/backend-api/codex`, OAuth bearer/account headers, `store: false`, encrypted reasoning continuity, and instructions. It also reported development-only refresh/injection through `CHATGPT_OAUTH` in `alchemy.run.ts`.

Those files and the cited commit are absent here. The old note called the reference Bridle despite its Erudane filename; provenance needs confirmation. Do not describe this checkout as having a working model integration. Preserve the narrower conclusion: application-owned OAuth plus Effect client configuration is a concrete reported candidate, so missing built-in OAuth does not require Codex to own the operator loop or a new full `LanguageModel` bridge.

## Effect provider boundary

Evidence: `repos/effect/packages/ai/openai/src/{OpenAiClient,OpenAiLanguageModel,OpenAiStructuredOutput}.ts`; [Effect reference map](effect-v4.md).

- The handwritten client defaults to the Platform API and supports configurable URL/HTTP transforms. It does not supply subscription login or refresh. `layerConfig()` reads only explicitly supplied Config values, not an implicit API key.
- Configuring another backend changes the transport, not entitlement or protocol compatibility. Headers alone cannot fix incompatible request fields, stream events, models, embeddings, or structured outputs. The `openai-compat` package targets Chat Completions, not subscription login.
- Direct OAuth/backend support for independent applications is not established by the reported code. Public client registration/issuance and provider support remain unresolved. Prefer validating the existing configuration pattern before inventing a larger adapter.

## Subscription billing and automation identities

- ChatGPT subscriptions and Platform API billing are separate. Codex subscription access is product-specific; neither a subscription nor Codex credits pays for arbitrary Platform calls. "No Platform API billing" and "fixed-price included usage only" are different constraints. [Billing](https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform), [auth](https://learn.chatgpt.com/docs/auth).
- Allowances vary by plan, model, context, tools, and duration. Parallel agents share applicable capacity, not extra entitlement. Local specialist review is general Codex usage, distinct from GitHub Code Review metering. No guaranteed universal concurrency count was found. Use account/rate-limit APIs and actual dashboards, not stale model/price rows. [Plan usage](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan), [pricing](https://learn.chatgpt.com/docs/pricing).
- Business flexible pricing combines seat limits with optional purchased workspace credits; Enterprise/Edu allocations depend on contracts. Pooled workspace credits do not establish permission to pool personal subscriptions. [Flexible pricing](https://help.openai.com/en/articles/11487671-flexible-pricing-for-the-enterprise-edu-and-business-plans).
- Business/Enterprise member-owned Codex access tokens explicitly support trusted CLI/app-server automation. They represent the creator's workspace identity, not a general API key, new seat, or extra allowance. Permission suspension can later reactivate tokens; revoke when access must end permanently. The dedicated page includes Business even though overview wording emphasizes Enterprise. Verify actual workspace availability. [Access tokens](https://learn.chatgpt.com/docs/enterprise/access-tokens).
- Workspace service accounts explicitly support shared unattended integrations, but require pay-as-you-go. This is clearer authorization for a non-human identity, not a fixed-price subscription solution or an automatic replacement for the chosen user-owned connection model. [Service accounts](https://learn.chatgpt.com/docs/enterprise/service-accounts).
- Workload identity federation is beta and workspace-gated. It maps OIDC/SPIFFE assertions to existing principals; it does not create membership or change billing. OpenAI credentials stay in memory for at most one hour, bounded by assertion/rule expiry. Protected assertion files need renewal; replay protection requires fresh `jti` values across separate exchanges. Namespace issuance compatibility is unknown. [Federation](https://learn.chatgpt.com/docs/enterprise/workload-identity).

## Codex-managed alternatives

- CLI `codex exec` reuses saved authentication. The TypeScript SDK wraps the CLI through JSONL, supports streaming/structured output, and resumes stored threads. A thread ID without its local session history is insufficient. [SDK](https://learn.chatgpt.com/docs/codex-sdk), [non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode); pinned SDK source is in [sources](sources.md).
- Remote login must occur for the host running Codex. Device auth is beta and permission-gated; documented callback forwarding uses loopback port 1455. Copying a user's cache to a trusted machine is not permission to share it with teammates. [Auth](https://learn.chatgpt.com/docs/auth).
- SDK environment inheritance and its `apiKey` option can introduce API credentials despite a saved ChatGPT login. Explicitly select/check the mode; quota/auth failures must not silently select API billing.
- Codex is the MCP client calling Bridle tools. Stdio and Streamable HTTP, tool allowlists, and bearer/OAuth are documented. Old Codex-as-MCP-server examples are obsolete according to the reviewed SDK docs. `tool_timeout_sec` defaults to 60 seconds and is configurable, not a hard maximum. Hours-long behavior remains untested. [MCP](https://learn.chatgpt.com/docs/extend/mcp).
- [App-server](https://learn.chatgpt.com/docs/app-server) provides bidirectional JSON-RPC without the `jsonrpc` header, thread/turn control, and experimental `dynamicTools` callbacks through `item/tool/call`. Codex still owns model/conversation semantics. Pin and generate its protocol schema if selected; it is not a Responses API replacement.
- Experimental externally managed `chatgptAuthTokens` requires access/account credentials and host refresh replies within about ten seconds. It is not evidence of independent OAuth-client authorization. The managed-cache CI guide excludes this mode.
- App-server docs describe custom clients and a stable subset but also warn that the command and WebSocket transport are experimental and unsupported for production workloads. Resolve that support ambiguity rather than removing the warning. Prefer local stdio for evaluation. Non-loopback WebSocket listeners may accept unauthenticated connections; transport auth and TLS/tunnelling are separate from the upstream Codex access token. [Maturity](https://learn.chatgpt.com/docs/feature-maturity).
- Built-in shell/filesystem tools, connectors, and managed approval settings require actual restriction. "Operator only" in a prompt is not access control. An indefinitely pending dynamic-tool callback is not documented durable state. Inactive unsubscribed threads may unload; resume and open callbacks are different mechanisms.

## Refresh, isolation, and service terms

- The [managed-auth CI guide](https://learn.chatgpt.com/docs/auth/ci-cd-auth) requires one machine or serialized job stream per auth-cache copy. Concurrent copies can race refresh-token rotation. Separate `CODEX_HOME` directories do not make one refresh lineage independent. Persist refreshed credentials, not an old seed. The guide excludes public/open-source repositories and allows reconnect to remain necessary.
- A shared cached connection needs serialized renewal and atomic persistence outside disposable boxes. Do not give each box a refresh-token copy. A transient network failure is not evidence of revocation; runtime adapters must distinguish reconnect-required from retryable failure.
- Codex file storage is plaintext; `auto` may fall back to files and `keyring` fails if unavailable. Environment variables and file permissions do not protect secrets from repository code running as the same user. WIF explicitly requires protected assertion paths outside tool access. Synthetic-secret isolation checks are in validation.
- Credentials must stay out of prompts, tool arguments/results, histories, review links, logs, traces, and artifacts. Effect `Redacted` is formatting protection, not encrypted storage; tool tracing can include parameters. Slack participation does not establish OpenAI credential ownership.
- [Account-sharing policy](https://help.openai.com/en/articles/10471989-openai-account-sharing-policy) permits one person's multiple devices, not multiple users sharing personal credentials. [Services Agreement](https://openai.com/policies/services-agreement/) restricts account sharing and limit circumvention. A successful member token does not settle entitlement for every teammate's jobs.
- [Individual terms](https://openai.com/policies/row-terms-of-use/) and [European terms](https://openai.com/policies/eu-terms-of-use/) contain programmatic-extraction restrictions, while Codex explicitly documents automation. This review does not resolve that interaction for a continuously running multi-user service. Confirm applicable business terms, jurisdiction, and support for the actual deployment.
- Codex's client license grants no hosted-model entitlement. [Service Terms](https://openai.com/policies/service-terms/) address documented API use, beta support, and generated-code licensing. Business/Enterprise data controls differ from personal-account defaults and API-organization settings; choose the applicable repository-data controls before sending code.

Technical success cannot answer shared-team entitlement, support, or fixed-cost limits. Keep those confirmations separate from the runtime experiment results.

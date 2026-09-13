# OpenAI authentication evidence

The first candidate is application-owned OAuth using Effect's existing OpenAI client. Codex-owned orchestration is an alternative, not a requirement. [Sources](sources.md) records the inspected revisions and local reference location. No login, refresh, or model request was run; [validation](validation-plan.md) owns runtime and provider-support checks.

## Local implementation evidence

Erudane's inspected source provides a concrete configuration pattern:

- `scripts/chatgpt/login.ts` implements authorization-code OAuth with PKCE, state validation, and a loopback callback. It uses the Codex public-client identifier, not an independently registered application client.
- `scripts/chatgpt/token.ts` persists access/refresh tokens, expiry, and account ID. `fresh` renews within five minutes of expiry and saves the rotated pair.
- `apps/api/src/model.ts` provides `OpenAiLanguageModel.layer` with `OpenAiClient.layer`, setting `apiUrl: "https://chatgpt.com/backend-api/codex"` and `transformClient` for bearer/account/backend headers. It uses `store: false`, encrypted reasoning continuity, and instructions. No Codex process or custom `LanguageModel.make` is required by this code.
- `alchemy.run.ts` invokes `fresh` during development configuration and injects `CHATGPT_OAUTH`. The model itself does not renew an expired token during a long-running session. Without that binding, Erudane selects its API-key path; that fallback must not be copied into Notus.

Notus currently has [login](../../scripts/chatgpt/login.ts) and [token](../../scripts/chatgpt/token.ts) scripts, not the model runtime. Their plaintext development storage requests `0600` on creation but has no distributed lock or atomic rotation. Account-ID extraction decodes an unverified JWT claim; it cannot authenticate incoming callers.

## Effect compatibility

Evidence: `repos/effect/packages/ai/openai/src/{OpenAiClient,OpenAiLanguageModel,OpenAiStructuredOutput}.ts`; [Effect notes](effect-v4.md).

- The client supports custom URL/HTTP transforms but supplies neither subscription login nor refresh. `layerConfig()` reads explicitly supplied Config values, not an implicit API key.
- A custom URL changes transport, not entitlement or protocol compatibility. Validate required request fields, models, tool results, streams, structured output, reasoning/phase continuity, and cancellation against the actual backend.
- `openai-compat` targets Chat Completions, not subscription authentication. Validate the existing configuration hooks before building another model protocol.

## Billing, identity, and credentials

- ChatGPT/Codex usage and Platform API billing are separate. Product credits can still incur spending; subscription-backed usage is not a universal fixed-cost guarantee. Parallel agents share applicable allowances. [Billing](https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform), [Codex usage](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan).
- Documented Codex automation does not establish support for an independent OAuth/backend client or permission to pool personal credentials across teammates. Confirm the actual workspace identity and applicable provider terms independently of technical success. [Account sharing](https://help.openai.com/en/articles/10471989-openai-account-sharing-policy), [Services Agreement](https://openai.com/policies/services-agreement/), [Service Terms](https://openai.com/policies/service-terms/).
- The [managed-auth CI guide](https://learn.chatgpt.com/docs/auth/ci-cd-auth) requires one machine or serialized job stream per cache copy and excludes public/open-source repositories. Separate `CODEX_HOME` directories do not make one refresh lineage independent; copying an old seed loses rotated credentials.
- File permissions, environment variables, and Effect `Redacted` do not isolate secrets from repository processes running as the same user. Tool traces can include parameters. Credentials must stay outside agent-accessible files, prompts, results, histories, logs, and artifacts.
- Business/Enterprise [member access tokens](https://learn.chatgpt.com/docs/enterprise/access-tokens) document trusted Codex automation under the creator's identity. [Service accounts](https://learn.chatgpt.com/docs/enterprise/service-accounts) support unattended shared integrations but require pay-as-you-go. Neither is an automatic substitute for the selected user-owned connection model or proof of direct Effect backend support.

## Codex-managed alternative

- The [TypeScript SDK](https://learn.chatgpt.com/docs/codex-sdk) wraps CLI execution and saved native threads. Inherited environment or SDK `apiKey` configuration can select API billing despite a saved subscription login; explicitly check the selected mode. See [auth](https://learn.chatgpt.com/docs/auth).
- Codex acts as an MCP client calling Notus tools. [MCP](https://learn.chatgpt.com/docs/extend/mcp) documents tool allowlists and configurable `tool_timeout_sec`, defaulting to 60 seconds. Hours-long waits remain untested. A prompt saying "operator only" does not restrict built-in shell/filesystem tools.
- [App-server](https://learn.chatgpt.com/docs/app-server) offers thread/turn control and experimental dynamic tools/external-token refresh. It still owns model/conversation semantics, and its production-support wording is qualified. Evaluate only if needed; an open tool callback is not documented durable state. Native session continuity constraints are in [Herdr](herdr.md#session-continuity-and-result-evidence).

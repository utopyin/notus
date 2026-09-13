# OpenAI authentication evidence

The first candidate is application-owned OAuth using Effect's existing OpenAI client. Codex-owned orchestration is an alternative, not a requirement. [Sources](sources.md) records the inspected revisions and local reference location. No login, refresh, or model request was run; [validation](validation-plan.md) owns runtime and provider-support checks.

## Local implementation evidence

Erudane's inspected source provides a concrete configuration pattern:

- `scripts/chatgpt/login.ts` implements authorization-code OAuth with PKCE, state validation, and a loopback callback. It uses the Codex public-client identifier, not an independently registered application client.
- `scripts/chatgpt/token.ts` persists access/refresh tokens, expiry, and account ID. `fresh` renews within five minutes of expiry and saves the rotated pair.
- `apps/api/src/model.ts` provides `OpenAiLanguageModel.layer` with `OpenAiClient.layer`, setting `apiUrl: "https://chatgpt.com/backend-api/codex"` and `transformClient` for bearer/account/backend headers. It uses `store: false`, encrypted reasoning continuity, and instructions. No Codex process or custom `LanguageModel.make` is required by this code.
- `alchemy.run.ts` invokes `fresh` during development configuration and injects `CHATGPT_OAUTH`. The model itself does not renew an expired token during a long-running session. Without that binding, Erudane selects its API-key path; that fallback must not be copied into Notus.

Notus now implements this pattern for the Worker: `@notus/openai` owns the Codex public-client refresh, the subscription-backend forward with a strict request allowlist, and the `LanguageModel` layer; `accounts/connections` owns one saved login per user with serialized refresh, rotated-pair persistence before use, revocation and operation-keyed replay; the Connection Durable Object hosts it. The [login](../../scripts/chatgpt/login.ts) and [token](../../scripts/chatgpt/token.ts) scripts remain development helpers whose plaintext file is only a seed for an explicit administrator link. Account-ID extraction still decodes an unverified JWT claim; it routes requests and authenticates nobody. Offline native validation is recorded in the [operator plan](../plans/operator.md); live backend behavior is not yet observed.

## Live findings, 2026-09-14

Two independent checks after the first operator deployment, both recorded without credential material:

- From a deployed Cloudflare Worker, `POST https://chatgpt.com/backend-api/codex/responses` returns HTTP 403 with a Cloudflare challenge HTML page even with an invalid bearer, so the rejection precedes authentication. A throwaway edge preview reproduced it (`.alchemy/inspection/edge-probe.ts`). The subscription backend is therefore unreachable from Workers egress as deployed; the operator's first live turns failed as `AuthenticationError:InsufficientPermissions`.
- From the user's machine with the fresh login, the same request authenticates but returns HTTP 400 `The '<model>' model is not supported when using Codex with a ChatGPT account.` for `gpt-5.4`, `gpt-5.4-codex`, `gpt-5.3-codex`, `gpt-5.2-codex`, `gpt-5.1-codex-max`, `gpt-5-codex` and `codex-mini-latest`, with and without streaming, instructions, or the Codex CLI originator and user agent. This reads as an account entitlement, not a request-shape problem, and is unresolved.

Neither finding changes the requirement to prefer subscription-backed usage; both block it on the current path. The user reports that the Codex CLI works with the same account, so the 400 is specific to this client and remains open. The user explicitly selected the Platform API key for the test stage instead; that is a recorded decision, not a silent fallback.

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

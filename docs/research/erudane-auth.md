# Correction: Bridle's subscription-backed Effect provider

Inspected 2026-09-12 after the user pointed to an existing implementation. This corrects the earlier inference that subscription-backed Bridle likely needs Codex to own the operator loop.

## Finding

Bridle implements ChatGPT-subscription authentication around Effect's existing `@effect/ai-openai` provider. It does not require a Codex CLI/app-server process or a custom `LanguageModel.make` implementation for this path.

The distinction is:

- **Built into Effect:** configurable OpenAI client URL, HTTP request transformations, and the language-model provider.
- **Implemented by Bridle:** OAuth authorization-code/PKCE login, token exchange, token persistence/refresh, account-ID extraction, backend-specific headers, and model configuration.
- **Not established by this inspection:** a current successful request, compatibility with Bridle's newer Effect pin and operator tool workload, or an official OpenAI support/stability commitment for independent applications calling this backend.

“No built-in subscription login” does not mean “subscription-backed calls cannot use the Effect provider.” The earlier research recommendation overstated that distinction.

## Source evidence

Local repository: `../bridle`.

Observed HEAD: `4be8c4137cd4e340f4a8e530517557981ab78311`. The inspected implementation files and package manifest had no working-tree changes. This is a local reference, not an additional Bridle subtree or a portable dependency.

| File                       | What it implements                                                                                                                                                                                                                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/chatgpt/login.ts` | OAuth authorization-code login with PKCE and state checking, a loopback callback, code exchange, and token persistence. Exposed as `bun run login:chatgpt`.                                                                                                                                                    |
| `scripts/chatgpt/token.ts` | Code/refresh-token exchange, stored expiry, account-ID extraction, private token-file permissions, and `fresh`, which refreshes within five minutes of expiry. Uses the Codex OAuth public-client identifier.                                                                                                  |
| `apps/api/src/model.ts`    | An `OpenAiLanguageModel.layer` provided with `OpenAiClient.layer`, using `apiUrl: "https://chatgpt.com/backend-api/codex"` and request transformations for the OAuth bearer, account ID, and backend headers. Configures `store: false`, encrypted reasoning continuity, instructions, and reasoning settings. |
| `alchemy.run.ts`           | Development-only credential loading/refresh and injection into `CHATGPT_OAUTH` before Worker initialization. This layer is absent in ordinary deployments.                                                                                                                                                     |
| `package.json`             | Pins Effect and `@effect/ai-openai` to `4.0.0-rc.111`. Bridle's reference is `4.0.0-rc.115`.                                                                                                                                                                                                                   |
| `apps/api/src/index.ts`    | Provides the model layer to the chat service.                                                                                                                                                                                                                                                                  |

No stored credentials, `.auth` contents, or environment secret files were read. No login, token refresh, model request, build, or test was executed. Bridle was not modified.

## Agreed login UX

A user performs interactive login once and Bridle securely persists the connection for reuse across tasks and dev boxes. Runtime token refresh is automatic. Reauthentication is an exception when the provider requires it, not a normal task-start step. The connection must outlive any individual dev box.

A proposed implementation is a single refresh owner per saved user connection, with serialized renewal and atomic persistence of rotated credentials. Do not give independent dev boxes copies of the same refresh token and let them race to rotate it. How the Effect operator and each specialist-agent host consume that managed connection still needs compatibility validation. This proposal does not change the user-owned login requirement into a pooled team credential.

## Consequence for Bridle

An Bridle-style OAuth/client adapter is now a concrete implementation candidate for the desired Effect-native operator. Do not require a move to Codex-owned orchestration merely because Effect does not ship OAuth login itself. The existing provider's configuration hooks may be enough; a new full provider bridge is not automatically required.

Before adopting it, validate:

1. Subscription login and backend availability for the selected identity, with explicit authorization for any live requests. Separate technical compatibility from provider support and shared-team entitlement.
2. Tool calls/results, structured outputs, streaming, reasoning continuity, model availability, errors, and cancellation on Bridle's exact Effect version.
3. Runtime token refresh. Bridle refreshes during development setup, then injects access/account credentials into the model service. The inspected model layer does not renew an expired token during an hours-long operator session.
4. Serialized refresh and rotated-token persistence for the intended concurrency. Do not assume copying one refresh-token snapshot into many dev boxes is safe.
5. Dev-box credential isolation, workspace attribution, and explicit behavior on expiry/quota failure. Bridle's development-only configuration is not a complete shared-team production auth service.

The alternative Codex/MCP and app-server paths remain options, not requirements. The claim that standard OpenAI Platform API billing is separate from ChatGPT subscriptions remains true. It does not imply that an Effect client configured for a different product backend automatically uses Platform API billing.

# Alchemy infrastructure

User decision: use Alchemy, https://alchemy.run, for Bridle's infrastructure deployment, with `alchemy.run.ts` as the stack entrypoint. This is a chosen tool, not an alternative to evaluate against Terraform or direct Wrangler deployment.

## Source pin

- Repository: https://github.com/alchemy-run/alchemy
- Local read-only subtree: `repos/alchemy`
- Branch: `main`
- Revision: `e6c5a3838f742443164a86708e2e4abca781aa92`
- Package: `alchemy@2.0.0-beta.77`, from `packages/alchemy/package.json`
- License: Apache-2.0, with additional third-party notices in the source tree
- Effect catalog: `>=4.0.0-rc.115 || >=4.0.0`; workspace override pins core Effect to `4.0.0-rc.115`

This is the Effect-based Alchemy v2 source, not the older async/await v1 API. Its current core Effect override matches Bridle's primary source pin. That is version evidence, not a tested installation or proof that all runtime dependencies interoperate.

The subtree's Git tree was compared against the upstream commit tree and matched. Upstream uses submodules for `distilled` and `floci`; those gitlinks were preserved but their contents were not fetched. The Alchemy source, examples, and docs are available locally. This is not a fully initialized upstream build checkout.

## Source-backed fit

Paths below are relative to `repos/alchemy/`.

| Concern                   | Inspected evidence                                                                                                            | Bridle consequence                                                                                                                                                                                                                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stack composition         | `website/src/content/docs/getting-started.mdx`; `packages/alchemy/src/Stack.ts`                                               | `Alchemy.Stack` takes a stack name, provider/state Layers, and an Effect program. Declare the deployment from `alchemy.run.ts`.                                                                                                                                                                      |
| Cloudflare support        | `examples/cloudflare-agent/alchemy.run.ts`; `packages/alchemy/src/Cloudflare/Providers.ts`                                    | Cloudflare resources and other provider Layers can compose in one stack. The example is a reference, not Bridle's deployment.                                                                                                                                                                        |
| Durable Objects           | `website/src/content/docs/cloudflare/compute/durable-objects.mdx`; `packages/alchemy/src/Cloudflare/Workers/DurableObject.ts` | Define a class with `Cloudflare.DurableObject`, bind it through the Worker, and address task instances by name. The source exposes typed RPC, fetch, alarm, and WebSocket handlers.                                                                                                                  |
| Hibernation               | `website/src/content/docs/cloudflare/compute/hibernatable-websockets.mdx`; `DurableObjectShape` in the source above           | Alchemy has an Effect-facing hibernatable WebSocket path to evaluate for devbox-to-task connections. Persist state and reconstruct socket metadata after hibernation.                                                                                                                                |
| Deployment authentication | Getting-started guide                                                                                                         | Alchemy uses deployment profiles. Those credentials are distinct from Bridle users' cached OpenAI logins and must not be passed to coding agents. No profiles were read or configured.                                                                                                               |
| Namespace provider        | Search of `packages/alchemy/src` for `namespacelabs` and `namespace.so` returned no matches                                   | A built-in Namespace integration was not found. Investigate a custom provider for long-lived Namespace configuration where useful; retain the runtime lifecycle adapter for task-driven devbox creation. `src/Namespace.ts` is an Alchemy naming concept, not evidence of a Namespace Labs provider. |

The recommended typed DO calls do not replace authentication or Schema validation at external HTTP/WebSocket boundaries. Alchemy's deployment state also does not replace task records, findings, approval history, or provider-login storage.

## Deployment and task lifetime

Proposed boundary, to confirm in the detailed architecture:

- Alchemy deploys Bridle's long-lived infrastructure: Workers, Durable Object bindings/classes, chosen storage, routes, and any required gateway/control service.
- The running orchestrator creates and manages per-task Namespace dev boxes through its Effect lifecycle service. Starting a task should not require a whole infrastructure deployment.
- Shared Namespace images, blueprints, or other durable configuration may warrant Alchemy resource providers. Their exact APIs and desired-state lifecycle remain research work.

Alchemy does not make the Namespace Node SDK Worker-compatible. It also does not make in-memory Effect fibers survive a Durable Object restart. The earlier runtime and persistence findings still apply.

## Next validation

Use Alchemy for the deployment portions of the existing [validation plan](validation-plan.md). Validate an exact normal-package dependency set, one Worker plus task DO, SQLite persistence, and inbound WebSocket hibernation before adding real orchestration. Select deployment state, stages, credential profiles, and retention policy in the infrastructure plan.

The source tests and examples can provision real resources. No Alchemy commands, dependency installs, tests, builds, authentication flows, or deployments were run here. No `alchemy.run.ts` application stack has been created yet; this pass records the chosen deployment tool and its reference source.

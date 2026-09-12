# Alchemy source map

References for the Effect-based Alchemy API, not the older async API. Paths are relative to `repos/alchemy/`; pins are in [sources](sources.md). Deployment ownership follows [architecture](../architecture/CONTEXT.md).

| Need | Source |
| --- | --- |
| Stack/provider/state composition | `website/src/content/docs/getting-started.mdx`; `packages/alchemy/src/Stack.ts` |
| Cloudflare stack example | `examples/cloudflare-agent/alchemy.run.ts`; `packages/alchemy/src/Cloudflare/Providers.ts` |
| Durable Object declaration/binding | `website/src/content/docs/cloudflare/compute/durable-objects.mdx`; `packages/alchemy/src/Cloudflare/Workers/DurableObject.ts` |
| Hibernatable WebSockets | `website/src/content/docs/cloudflare/compute/hibernatable-websockets.mdx`; `DurableObjectShape` in the source above |
| Node container host | `packages/alchemy/src/Cloudflare/Containers/{Container,ContainerPlatform}.ts`; `packages/alchemy/src/Runtime/Bootstrap/CloudflareContainerNode.ts` |

Constraints from inspection:

- `Alchemy.Stack` composes an Effect program with provider/state Layers. Deployment profiles are infrastructure credentials, not users' model-provider connections.
- Durable Objects expose typed RPC, fetch, alarm, and WebSocket handlers. Those types do not authenticate external messages or make in-memory Effect waits durable. See [Cloudflare](cloudflare.md).
- Container source binds a process to a DO and implements fetch-based RPC over its port; a Node bootstrap exists. Declaration and implementation must stay separate to avoid pulling Node dependencies into the Worker bundle. This is a candidate Namespace control-adapter host, not proof of account availability, SDK transport compatibility, or a working deployment.
- No Namespace Labs provider was found in the inspected provider tree. `src/Namespace.ts` is Alchemy's naming concept, not Namespace Labs support. A custom provider for shared Namespace configuration remains a possibility, not a prerequisite for runtime task provisioning.
- Upstream gitlinked dependencies are not initialized. This checkout is reference material, not a complete upstream build installation. Source examples/tests can create real resources.
- Matching declared Effect versions does not prove the actual installed build/runtime graph. Deployment state, stages, profiles, and resource topology remain infrastructure-planning choices. [Validation](validation-plan.md) covers the Worker/DO/package experiment.

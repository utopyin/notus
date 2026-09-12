# Bridle

A shared-team coding-agent orchestrator that handles the coordination between planning, implementation, specialist reviews, QA, and fixes. Humans answer planning questions, approve the plan, review the finished code, and merge.

An AI operator makes workflow decisions. Typed Effect tools launch agents, await results, record findings, and route human requests. The initial target is Effect v4, Alchemy v2 for infrastructure deployment, Cloudflare Durable Objects, Namespace dev boxes, Herdr, and Plannotator.

## Current state

Research and architecture design. Workspace tooling and local login scripts are present; there is no runnable Bridle orchestrator or cloud deployment yet.

- [Product context and agreed behavior](CONTEXT.md)
- [Proposed monorepo design](docs/plans/codebase.md)
- [Research findings and remaining decisions](docs/research/README.md)
- [Pinned source inventory and subtree updates](docs/research/sources.md)
- [Agent instructions](AGENTS.md)

## Layout

Four tiers, four directories. See [the tier rules](docs/architecture/CONTEXT.md) and [proposed package ownership](docs/plans/codebase.md).

- `packages/`: provider communication and genuinely shared values.
- `domains/`: provider-neutral services and their default provider implementation Layers, grouped into workspaces, accounts, tasks, and executions.
- `entrypoints/`: control HTTP/WebSocket interfaces and the operator's AI tool interface.
- `apps/`: the Cloudflare API runtime and the dev-box runtime, selecting/configuring the domain Layers.

This is the proposed layout, not a claim that those application packages already exist.

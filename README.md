# Bridle

A shared-team coding-agent orchestrator that handles the coordination between planning, implementation, specialist reviews, QA, and fixes. Humans answer planning questions, approve the plan, review the finished code, and merge.

An AI operator makes workflow decisions. Typed Effect tools launch agents, await results, record findings, and route human requests. The initial target is Effect v4, Alchemy v2 for infrastructure deployment, Cloudflare Durable Objects, Namespace dev boxes, Herdr, and Plannotator.

## Current state

Research and design only. There is no runnable Bridle application, package installation, or cloud deployment yet.

- [Product context and agreed behavior](CONTEXT.md)
- [Research findings and remaining decisions](docs/research/README.md)
- [Pinned source inventory and subtree updates](docs/research/sources.md)
- [Agent instructions](AGENTS.md)

## Reference repositories

`repos/` contains squashed Git subtrees for Effect, Alchemy, Herdr, the Herdr TypeScript SDK, the Namespace TypeScript SDK, and Plannotator. Read them as references; do not edit them or import application code from them.

Effect v4 is an explicit requirement. The imported Effect core is `4.0.0-rc.115`, while the Herdr SDK currently pins an older v4 beta. Consult the research notes before selecting a dependency set.

# Notus

A shared-team coding-agent orchestrator. An AI operator coordinates planning, implementation, reviews, and QA; humans approve plans and review and merge the finished code.

A Slack mention starts a task. The operator runs in the task's Durable Object, works on a dev box through durable tool calls, opens a pull request with a GitHub App, and answers in the thread; pull request comments continue the task. Nothing Notus holds can merge.

## Documentation

| Document                                     | Owns                                                        |
| -------------------------------------------- | ----------------------------------------------------------- |
| [Product context](CONTEXT.md)                | Requirements, vocabulary, and scope                         |
| [Agent instructions](AGENTS.md)              | Working practices and code style                            |
| [Architecture](docs/architecture/CONTEXT.md) | Tiers, provider boundaries, service/Layer and runtime rules |
| [System design](docs/architecture/system.md) | Primitives, system context, code tiers, hosts and secrets   |
| [Reference sources](docs/sources.md)         | Vendored `repos/` revisions and how to update them          |

## Stages

A stage is either a developer's own, named after `$USER`, or `production`. `bun run deploy` deploys your stage from the ignored `.env.dev` (start from [.env.example](.env.example)); `bun run deploy:production` deploys production from `.env.production`. Each stage owns its Workers, D1 databases, Durable Objects and hostnames: production serves `notus.run` and `api.notus.run`, a developer stage `<stage>.notus.run` and `api.<stage>.notus.run`. The rule lives in `@notus/shared/hosts`. Credentials come from the Alchemy profile selected by `ALCHEMY_PROFILE` in the env file.

## License

[GPL-3.0](LICENSE). The upstream snapshots under `repos/` keep their own licenses.

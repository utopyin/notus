# Bridle

A shared-team coding-agent orchestrator. An AI operator coordinates planning, implementation, reviews, and QA; humans approve plans and review and merge the finished code.

Status: planning. Workspace tooling and local login scripts exist; the orchestrator is not implemented. Dependency versions and commands live in [package.json](package.json).

## Documentation

Each topic has one canonical home:

| Document | Owns |
| --- | --- |
| [Product context](CONTEXT.md) | Requirements, vocabulary, scope, and open product decisions |
| [Agent instructions](AGENTS.md) | Working practices and code style |
| [Architecture](docs/architecture/CONTEXT.md) | Tier boundaries, provider separation, and service/Layer conventions |
| [Codebase proposal](docs/plans/codebase.md) | Package responsibilities and reviewed runtime/data recommendations |
| [First tracer](docs/plans/tracer.md) | End-to-end scenario, runnable increments, and blocking experiments |
| [Research](docs/research/README.md) | Provider evidence and constraints |
| [Source inventory](docs/research/sources.md) | Inspected revisions and reference maintenance |
| [Validation plan](docs/research/validation-plan.md) | Unproven integrations and acceptance criteria |

Next: execute the first tracer's narrow compatibility probes, then build its durable source round trip. Live experiments require separate authorization.

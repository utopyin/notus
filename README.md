# Notus

A shared-team coding-agent orchestrator. An AI operator coordinates planning, implementation, reviews, and QA; humans approve plans and review and merge the finished code.

Status: the dedicated Slack readiness slice is deployed. The user confirmed initial readiness and warm/cold wake on the retained devbox. Existing simulation tasks retain their mode. Models, repository checkout and production deployment remain disabled. See [devbox results](docs/research/devbox-results.md) and [intake results](docs/research/intake-results.md). Dependency versions and commands live in [package.json](package.json).

## Documentation

Each topic has one canonical home:

| Document                                            | Owns                                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------- |
| [Product context](CONTEXT.md)                       | Requirements, vocabulary, scope, and open product decisions                     |
| [Agent instructions](AGENTS.md)                     | Working practices and code style                                                |
| [Architecture](docs/architecture/CONTEXT.md)        | Tier boundaries, provider separation, and service/Layer conventions             |
| [Codebase proposal](docs/plans/codebase.md)         | Package responsibilities and reviewed runtime/data recommendations              |
| [First tracer](docs/plans/tracer.md)                | End-to-end scenario, runnable increments, and blocking experiments              |
| [Source round trip](docs/plans/intake.md)           | First slice's interfaces, infrastructure, persistence, and implementation order |
| [Devbox slice](docs/plans/devbox.md)                | Opaque provider configuration, base image, and authorized startup validation    |
| [Research](docs/research/README.md)                 | Provider evidence and constraints                                               |
| [Source inventory](docs/research/sources.md)        | Inspected revisions and reference maintenance                                   |
| [Validation plan](docs/research/validation-plan.md) | Unproven integrations and acceptance criteria                                   |
| [Intake results](docs/research/intake-results.md)   | First-slice verification evidence, limitations, and simulation setup            |
| [Devbox results](docs/research/devbox-results.md)   | Image artifacts, startup validation, and remaining execution gates              |

The completed slice follows the [readiness plan](docs/plans/provisioning.md). Next is an initiator-authorized model round trip, followed by repository access. Both still require separate authorization and validation.

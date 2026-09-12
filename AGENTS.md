# Working in Bridle

## Before changing code

- Read [product context](CONTEXT.md). Read [architecture](docs/architecture/CONTEXT.md) before adding packages, imports, services, or Layers. Proposals live in `docs/plans/`.
- State assumptions and tradeoffs. Ask when the intended behavior is unclear.
- Fix the underlying ownership/source-of-truth problem when relevant, not just the local symptom.
- Do not add test files by default unless requested. Preserve unrelated user changes.

## References

- Prefer inspected source over guesses. `repos/` is read-only reference material: never edit it or import it into application code.
- [Source inventory](docs/research/sources.md) owns revisions and update instructions; [package.json](package.json) owns dependency versions.
- Before Effect work, read the [Effect skill](.agents/skills/effect/SKILL.md), [vendored guide](repos/effect/LLMS.md), and relevant [migration guide](repos/effect/migration/). Follow the pinned v4 APIs, not v3 examples.
- For Alchemy, use the vendored [examples](repos/alchemy/examples/) and [documentation](repos/alchemy/website/src/content/docs/).

## Code style

- Commits use terse conventional messages: `feat(scope): imperative change` or `fix: imperative change`.
- Imports have no file extension. Prefer focused package subpaths over root barrels; the [service convention](docs/architecture/CONTEXT.md#services-and-layers) defines the single-import happy path.
- Keep exports small. The import path supplies scope, so prefer short local names. Keep service tag IDs globally distinct.
- Export shared domain shapes from the owner's `types.ts` / `errors.ts`; do not copy definitions between consumers.
- Files are nouns; functions are verbs. Use `progress.ts`, not `get-sync-progress.ts`.
- Avoid repeating ancestor names and more than two hyphenated words. Prefer established roles such as `service`, `types`, `errors`, `state`, or a plain domain noun.
- Avoid vague `common/` and `shared/` directories. Shorten redundant names, fold small helpers into a suitable sibling, or create a meaningful directory with at least two files. Single-file directories require a framework reason.

## Documentation

Use the [documentation map](README.md#documentation). Keep each fact in its owning document and link to it elsewhere. Separate agreed requirements, proposals, and inspected-but-unvalidated behavior. Do not copy SDK tutorials or version tables into project rules.

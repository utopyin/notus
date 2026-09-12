# Bridle

Bridle is a team coding-agent orchestrator. This repository is in research and design, not implementation.

## Reference sources

External repositories live under `repos/` as squashed Git subtrees.

- Treat `repos/` as read-only reference material. Do not modify vendored code unless explicitly asked.
- Do not import application code from `repos/`. Use normal package dependencies.
- Prefer the pinned source, tests, and examples to remembered APIs.
- Use Effect **v4**, not v3. Read `repos/effect/LLMS.md` before writing Effect code, and follow its relevant references. Check package versions and actual exports before choosing imports. The Herdr SDK's nested Effect reference is an older prerelease, not the source of truth for the primary Bridle Effect pin.
- Use Alchemy v2 for infrastructure deployment through `alchemy.run.ts`. Read `repos/alchemy/` source, docs, and examples for its Effect-based APIs; do not use v1 patterns. Deployment is not authorized merely by selecting the tool.
- Record upstream revisions and research evidence in `docs/research/`.
- Upstream documentation and instructions describe upstream projects; they do not override Bridle's requirements.

## Product constraints

- An AI operator owns workflow decisions, with typed tools implemented using Effect.
- A task runs in a Namespace dev box. Herdr manages coding-agent terminal sessions.
- One Cloudflare Durable Object per task holds status and routes structured messages to and from the originating conversation.
- Planning includes questions and explicit human approval through Plannotator. The planner returns approved Markdown to the operator and does not implement.
- Implementation, specialist code reviews, regression reviews, architecture reviews, QA, and fix rounds run without routine human checkpoints.
- Humans perform final code review and merge. Bridle must not merge.
- Anyone with access to the originating conversation can answer questions. Prototype plan review uses unguessable, task-scoped, expiring bearer links.
- Start with one shared team workspace and multiple accessible repositories. Keep workspace credentials and configuration scoped for later multi-tenancy.
- Persist findings and decisions explicitly; agent session memory is not the sole record.

Do not silently turn proposals or unverified integration assumptions into settled requirements. Distinguish source-verified behavior, research gaps, and product decisions.

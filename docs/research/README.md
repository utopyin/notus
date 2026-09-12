# Research index

Source evidence for infrastructure and service planning. This folder does not define [product requirements](../../CONTEXT.md), [architecture conventions](../architecture/CONTEXT.md), or [package ownership](../plans/codebase.md).

The initial review inspected source, upstream test bodies, official documentation, and selected package archives. It did not establish runtime interoperability. No live authentication, agent, browser-approval, or deployment experiment has passed.

- [Sources](sources.md): revisions, versions, distribution evidence, and update commands.
- [Validation plan](validation-plan.md): unresolved experiments, dependencies, and success criteria.
- [Alchemy](alchemy.md): deployment APIs and source map.
- [Cloudflare](cloudflare.md): storage, hibernation, and runtime limits.
- [Namespace](namespace.md): provisioning, bootstrap, credentials, lifetime, and ingress.
- [Herdr](herdr.md): terminal readiness, waits, results, and session continuity.
- [Plannotator](plannotator.md): strict gate protocol and approval trust boundary.
- [OpenAI authentication](openai-auth.md): OAuth implementation evidence, subscription access, and automation limits.
- [Slack](slack.md): Distilled API evidence and ingress constraints.
- [Effect](effect-v4.md): reference map and integration-specific caveats.

Integration notes own evidence, not separate implementation backlogs. "Source" describes inspected code; "documented" describes provider claims. Neither means tested in Bridle. Historical web/package observations are dated in [sources](sources.md), not assertions about today's releases.

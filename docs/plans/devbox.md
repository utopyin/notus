# Devbox configuration and base image

Authorized slice following the [simulation intake](intake.md). The user approved implementation, image publication, and an isolated live Namespace startup test in the currently authenticated workspace `<namespace-tenant>`. Existing resources must remain untouched. This is not authorization to run a model, execute repository code, or enable automatic provisioning from Slack.

## Deliverables

- Workspaces persists a versioned default environment: provider key plus opaque JSON. It does not understand blueprint IDs, images, machine settings, environment variables, or secret references. No public configuration/admin endpoint is introduced.
- `packages/namespace` owns its native configuration codec and fetch-compatible control API. Stored JSON is the source of truth; decoding and re-encoding must not silently discard fields. Start with native direct-image creation. Unsupported template/bootstrap behavior must fail explicitly, not mutate a shared template.
- `packages/herdr` implements only the native local readiness operations needed here, without the incompatible SDK Effect graph.
- `apps/devbox` supplies an extensible, checksum-pinned Herdr/Bun image and foreground supervisor. A Namespace session starts the supervisor. A fresh native ping and snapshot establish runtime readiness, not task authorization or semantic task completion.
- A derived image demonstrates adding project tools and registering it with the provider's native capabilities. Record actual OCI references and resolved image identities rather than assuming a registered image name works in Docker `FROM`.

Provider settings belong to the provider package. Do not introduce a shared devcontainer schema, generic machine-size translation, or configuration framework. Repository-specific selection waits for a repository model; the initial persisted setting is the workspace default.

## Runtime boundary

The image contains no model credentials, repository credentials, native OAuth caches, provider CLI login, or agent restoration. It must not launch a model or specialist. Readiness checks are bounded and validate the native protocol; socket existence or a running process is insufficient.

Image extensions are trusted executable inputs: a child Dockerfile can replace any image file. Non-root execution and separate processes do not prove isolation from repository code. Model authorization, credential-broker support, enforced isolation, authenticated attempt binding, durable provisioning intent, and result acceptance remain gates before real execution.

Preserve the working Slack simulation. No new public debug route, production deployment, GitHub integration, approval flow, or real-execution flag is enabled in this slice.

## Validation

1. Frozen dependency install, uncached workspace/root typechecks, focused formatting/lint and diff checks.
2. Opaque JSON persistence and revision checks using native D1; provider codec round trips, invalid configuration, redacted errors, and full-operation timeout/ambiguity behavior with local mocks. Keep test harnesses machine-local unless the user requests repository tests.
3. Build Linux AMD64 from an allowlisted context excluding repository secrets and research trees. Check artifact hashes, effective user, file permissions, native protocol readiness, duplicate startup, failure handling, and termination.
4. Publish only named Notus test images. Create only isolated Notus test devboxes, with repository checkout and GitHub credential sharing disabled, private access, and no privileged execution.
5. Verify the provider client in workerd against the selected Namespace workspace, without embedding a control credential in source or exposing an unauthenticated proxy. Do not retry uncertain creation blindly.
6. Verify a derived image and stop/start readiness. Expire the disposable test boxes when finished; retain explicitly named image artifacts and record their identities and limitations.

Record observed results separately in `docs/research/devbox-results.md`. Do not present planned checks as completed, or successful readiness as model execution, approval, isolation, or auto-sleep proof.

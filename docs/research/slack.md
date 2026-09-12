# Slack integration evidence

Evidence from the published Distilled Slack/core archives recorded in [sources](sources.md).

## Inspected Distilled behavior

Paths refer to the published Slack package; upstream [source](https://github.com/alchemy-run/distilled/tree/main/packages/slack) can move independently.

- `src/credentials.ts` defines a `Context.Service` resolving token/base URL through an Effect. Static credentials have a helper Layer; custom resolution can be workspace-scoped.
- `src/protocol.ts` requires credentials and Effect `HttpClient`, resolving credentials per request rather than capturing one workspace token in its memoized protocol Layer. It is not a wrapper around the official Node `WebClient`.
- Slack HTTP-200 `ok: false` bodies become errors. Authentication/rate-limit categories are typed, but method-specific failures can remain generic `SlackError`; not every Slack error has a dedicated class.
- `src/services/chat.ts` exposes `postMessage` with `channel`, `text`, `thread_ts`; `updateChat` maps to `chat.update`. The normal package has a focused `/chat` export.
- Explicit `worker` export conditions do not prove compatibility. The decoder references `process.env.DISTILLED_DEBUG_HTTP`. Validate the actual Alchemy build with `FetchHttpClient` and keep debug body logging disabled.
- Inspect retries before message mutations. An uncertain response can follow a successful send, so retries need delivery reconciliation rather than assumed exactly-once behavior.

## Ingress is separate

The Web API package does not establish an inbound event receiver. [Slack signature verification](https://docs.slack.dev/authentication/verifying-requests-from-slack/) requires the untouched raw body and timestamp freshness, not a reserialized payload. Verified actor/installation identity must precede task routing.

Events/interactions need prompt acknowledgement after durable admission, retry deduplication, bot-message filtering, and correct thread correlation. Required scopes and reply access depend on the start gesture. HTTP delivery is the Worker-hosted candidate; SDK availability alone is no reason to introduce Socket Mode.

Slack installation credentials are not users' OpenAI connections. SDK selection does not decide the trigger UX or who may use a saved model account. Those decisions remain in product/service planning. [Validation](validation-plan.md#6-control-persistence-and-slack) owns the ingress, delivery, and runtime checks.

# Slack SDK candidates

Research date: 2026-09-12. Slack is the selected first input source; the user has selected **`@distilled.cloud/slack`** for its outbound SDK. Runtime integration remains untested.

## Selected SDK

Use **`@distilled.cloud/slack`** for the Slack Web API side of Bridle's Effect adapter. This is part of the Alchemy/Distilled project and its published package declares Effect v4 compatibility. Keep Slack event ingestion and Bridle's domain mapping separate from the outbound API client.

## Options checked

| Option                              | Evidence                                                                                                                                                                                  | Fit                                                                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Official `@slack/web-api`           | [Slack Node SDK docs](https://docs.slack.dev/tools/node-slack-sdk/) describe the Web API, OAuth, webhook, and Socket Mode packages. Bolt supplies application event/interaction handling. | Established official client. Can wrap Promise methods in Effect services; Node/Worker compatibility needs validation. |
| `effect-slack@0.4.0` by MateoKruk   | [Manifest](https://github.com/MateoKruk/effect-slack/blob/d731b47ba1076aac94a15f8e71f22e96a05a0afd/package.json) depends on `@slack/web-api@7.18.0` and declares peer `effect: ^3.0.0`.   | Existing Effect-native wrapper, but not a drop-in dependency for Bridle's v4 implementation.                          |
| `@distilled.cloud/slack@1.0.0-rc.9` | [Published npm metadata](https://registry.npmjs.org/@distilled.cloud%2fslack/1.0.0-rc.9) declares Effect v4 support from `4.0.0-rc.112`, or stable v4+, and dependency `@distilled.cloud/core@1.0.0-rc.9`. [Source](https://github.com/alchemy-run/distilled/tree/main/packages/slack). | Selected SDK. Bridle's `4.0.0-rc.115` satisfies the declared range. Actual imports and Worker behavior remain untested. |

The published Distilled Slack and core archives were downloaded to a temporary research directory and inspected as data. Nothing was installed or executed. This is stronger evidence than an unpublished repository manifest, but it is not a runtime test.

Slack archive: https://registry.npmjs.org/@distilled.cloud/slack/-/slack-1.0.0-rc.9.tgz

Registry integrity: `sha512-6xKUvqS0ApQ4A0Rq49MP9Jjwc0+1Gn+sMfaxv1AaZ0LTq959OasGepNIqXTSYT6DNKI7imcVWws3jTGI3wYYqw==`.

## Inspected Distilled API

Paths relative to the published Slack package:

- `src/credentials.ts`: a v4 `Context.Service` containing an Effect that resolves token/base URL. `credentials({ token })` provides a static Layer; custom services can supply workspace-scoped credentials.
- `src/protocol.ts`: operations require `Credentials` and Effect's `HttpClient`. The protocol resolves credentials per request rather than capturing one tenant's token in its memoized protocol Layer.
- `src/protocol.ts`: Slack's HTTP-200 `ok: false` responses become errors; authentication and rate-limit failures have typed categories. Method-specific slugs still use a generic `SlackError` where no dedicated model exists. Do not claim every Slack error code has its own class.
- `src/services/chat.ts`: `postMessage` includes `channel`, `text`, and `thread_ts`; `updateChat` maps to `chat.update`. Import through the normal package's `/chat` export.
- `package.json`: explicit `worker` export conditions and public credential/protocol/service exports. An export condition is not proof of runtime compatibility; the inspected decoder also references `process.env.DISTILLED_DEBUG_HTTP`.

The protocol is Effect-HTTP-based, not a wrapper around the official Node `WebClient`. Evaluate it with `FetchHttpClient` and the chosen Alchemy Worker build. Inspect retry policy before using message mutations, particularly uncertain delivery after a timeout. Keep debug response logging disabled to avoid leaking message content.

## Bridle adapter responsibilities

A Web API SDK does not implement the complete input adapter. Proposed split:

1. An Alchemy-deployed Worker receives Slack HTTP events/interactions, verifies their signatures against the **raw request body**, checks timestamp freshness, decodes supported payloads, durably records/deduplicates them, and acknowledges promptly.
2. The Slack adapter maps workspace/channel/thread/user identity into Bridle's neutral task and human-response contracts. It keeps Slack payloads out of operator/domain APIs.
3. The outbound implementation uses Distilled operations to post questions, approval links, progress, and handoff messages to the saved originating thread. Slack installation credentials are distinct from each user's cached OpenAI connection.

Signature evidence: [Slack request verification](https://docs.slack.dev/authentication/verifying-requests-from-slack/). Events, interaction acknowledgements, installation scopes, bot-message filtering, retry IDs, and access to thread replies need their own adapter design and tests. No inbound event receiver was established by inspecting the Distilled Web API package.

Use HTTP delivery for the first Worker-hosted candidate rather than adding Socket Mode solely because an SDK exists. That is a deployment recommendation, not a finalized trigger UX. The user still needs to choose how a task starts within Slack, such as an app mention, shortcut, or command.

No Slack app was created, no tokens were accessed, and no Slack messages or API calls were sent.

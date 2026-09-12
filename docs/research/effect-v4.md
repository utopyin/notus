# Effect integration reference

Use the [Effect skill](../../.agents/skills/effect/SKILL.md), [vendored LLMS guide](../../repos/effect/LLMS.md), and relevant `repos/effect/migration/` guides for implementation. Service/Layer conventions belong to [architecture](../architecture/CONTEXT.md). [Sources](sources.md) owns exact dependency/runtime pins. This note keeps integration constraints, not another Effect tutorial.

## Source map

Paths are relative to `repos/effect/`. The initial review inspected these implementations and examples, not runtime behavior in Bridle.

| Concern | Reference |
| --- | --- |
| Services, errors, causes | `migration/{services,error-handling,cause}.md`; `packages/effect/src/{Context,Layer,ManagedRuntime}.ts` |
| Model/tools/chat | `ai-docs/src/71_ai/{10_language-model,20_tools,30_chat}.ts`; `packages/effect/src/unstable/ai/{LanguageModel,Toolkit,Tool,Chat,Prompt}.ts` |
| OpenAI transport/schema | `packages/ai/openai/src/{OpenAiClient,OpenAiLanguageModel,OpenAiStructuredOutput}.ts` |
| Child processes | `ai-docs/src/60_child-process/10_working-with-child-processes.ts` |
| Durable Object SQL | `packages/sql/sqlite-do/src/SqliteClient.ts`; tests use fake DO storage |
| Chat backing store | `packages/effect/src/unstable/persistence/Persistence.ts` |

Core AI is `effect/unstable/ai`; providers are separate packages such as `@effect/ai-openai`. There is no standalone core `@effect/ai` at this pin. Use source exports over stale guide snippets such as `effect/schema` or APIs from other prereleases. Node transitive engine requirements and Herdr's incompatible direct Effect pin need a tested dependency set, not forced overrides.

## Model/tool semantics that affect planning

- `generateText` performs one provider generation and tool resolution, not the next model turn. `Chat` retains history and serializes generation per instance. The example multi-turn loop is application code. `ExecutionPlan` is resource/provider fallback, not an operator workflow.
- Resolver concurrency defaults to unbounded. Provider `parallel_tool_calls` is not the local execution limit. Generation waits for handlers; streaming preliminary results does not let the same chat start another model turn while a tool remains pending.
- `Toolkit.handle` returns an Effect containing a Stream. It validates parameters and executes handlers, but not `LanguageModel` approval evaluation. Returned tool-call parameters remain encoded; handlers receive decoded values. Match results by call ID, not completion order.
- `disableToolCallResolution` stops newly generated calls, but already approved pending calls can execute earlier in the generation path. It is not a universal no-side-effects flag. Model approval parts are protocol data, not trusted human authorization.
- Tool `failureMode: "return"` returns modeled failures, not every defect/interruption or encoding failure. Incomplete streams may interrupt handlers after side effects occurred. Retrying a generation is not necessarily safe.
- OpenAI structured-output conversion requires an object root, may rewrite optional values as nullable, and can omit provider-unsupported constraints. Effect decoding remains authoritative. Tool tracing can annotate parameters; keep credentials out of them.

## Persistence and cancellation limits

- `Chat.layerPersisted` saves whole history after generation/finalization; save/load failures can become defects. A tool may commit before history saves. Separate loads of one chat ID have separate refs/semaphores, not a distributed single-writer lock.
- Chat export is not task state, a fiber continuation, or a terminal snapshot. `ResponseIdTracker` keys live object identities, so restored JSON needs a full-history fallback with required provider metadata.
- `forkChild` ends with its parent; scoped fibers end with their scope. Detached fibers and `ManagedRuntime` do not survive process loss. Finalizers are not guaranteed after host loss.
- AbortSignal propagation only cancels implementations that honor it. Interrupting a request/observer does not undo accepted remote work or prove a Herdr process stopped. Default uninterruptible acquisition must not contain indefinite waits.
- The SQLite DO driver accepts `db` for ordinary SQL, but transactions require full `storage`; nested transactions fail. Its fake-storage tests do not establish Cloudflare behavior. Generic SQL chat persistence starts a periodic cleanup fiber, unsuitable to assume durable across hibernation.
- `NodeServices.layer` does not supply an HTTP client. `FetchHttpClient` is a plausible cross-host transport, but bundle/stream/abort behavior still needs checking. OpenAI WebSocket mode requires nonstandard authorization-header constructor options documented for Node/Bun, not a browser/global WebSocket substitute.

OAuth and Codex compatibility belong to [OpenAI evidence](openai-auth.md). In particular, encrypted reasoning support does not establish assistant `phase` round-tripping, tool/stream compatibility, runtime refresh, or independent-client support. [Validation](validation-plan.md) owns the dispatch, history, provider, and Worker experiments.

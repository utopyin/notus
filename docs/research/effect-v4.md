# Effect v4 architecture research for Bridle

## Scope and evidence

This is source research, not an implementation or a successful integration test. Only this document was written. The `repos/effect/` subtree was read-only. No packages were installed, code compiled, tests run, provider requests made, credentials inspected, or commits created.

Evidence labels used below:

- **Verified** means inspected in the pinned source, manifests, examples, or test bodies. A test citation means the upstream test asserts that behavior, not that this research ran it.
- **Constraint** means required by the user or Bridle's `AGENTS.md`.
- **Proposal** means an architecture recommendation, not an approved product decision.
- **Unvalidated** means a runtime, deployment, or integration claim that still needs a spike.

Source paths and line ranges below are relative to `repos/effect/` unless stated otherwise. Unqualified core AI filenames refer to `packages/effect/src/unstable/ai/`; their test filenames refer to `packages/effect/test/unstable/ai/`. Unqualified core modules such as `Effect.ts` refer to `packages/effect/src/`. OpenAI filenames refer to `packages/ai/openai/src/` unless another provider is named. The full [LLMS.md](../../repos/effect/LLMS.md), lines 1-409, was read, followed by its relevant local examples, migration guides, Schema guide sections, implementations, and tests. Source and package exports take precedence where prose examples disagree with them.

## Top findings

1. The pin is **Effect `4.0.0-rc.115`**, upstream commit `51d4a2f08a5c7691dc876415bc9fc0ecf467e153`. This is v4 development on upstream `main`, not v3. Use matching exact versions for Effect ecosystem dependencies.
2. Core AI APIs live in `effect/unstable/ai`. `packages/ai/` holds provider packages, including `@effect/ai-openai`. There is no standalone core `@effect/ai` package in this pin. Services use `Context.Service`, not `ServiceMap.Service` or v3's `Context.Tag` and `Effect.Service`.
3. Effect supplies model calls, schema-backed tools, concurrent tool resolution, chat history, persistence interfaces, and cancellation machinery. **Bridle must write the operator's multi-turn driver and durable task protocol.** The model must decide workflow transitions. Neither `ExecutionPlan` nor a deterministic sequence of review stages is that operator.
4. Tool concurrency defaults to `"unbounded"`. A generation waits for its tools to finish. Streaming exposes preliminary progress, but does not let the same chat perform another model turn while a long tool is still running. Bridle should prototype short start/status/cancel tools plus durable operation handles for Herdr work.
5. `Chat.layerPersisted` persists conversation history, not task state or exactly-once side effects. Automatic saves happen after generation/finalization. Save failures become defects. A separate operation journal and state checkpoint are necessary.
6. `LanguageModel.make` is a real public adapter boundary for a custom Codex bridge. The OpenAI client is an API-key/Bearer HTTP client, not a ChatGPT subscription login or token-refresh implementation. Subscription-backed Codex feasibility and authorization remain separate, unvalidated questions.
7. A Node operator in the Namespace dev box and a small task Durable Object are a sensible split to test. There is an actual `@effect/sql-sqlite-do` driver. Neither that driver nor `ManagedRuntime` proves that long-lived fibers survive Cloudflare object eviction. OpenAI WebSocket mode explicitly documents Node/Bun-only constructor requirements.
8. The Node manifest says `>=18`, but its pinned `undici@8.10.2` requires **Node `>=22.19.0`**. Do not choose the dev-box runtime from the platform manifest alone.

## 1. Revision, versions, packages, and licenses

### Pinned identity

Verified Git evidence:

| Item | Value |
| --- | --- |
| Bridle subtree import commit | `d75de1cf25e5ba956b2b88c8353068184c7aafee` |
| Squash commit | `c38618d7d3f02771bb2788e5c9959e4d3bad06cc` |
| `git-subtree-split` | `51d4a2f08a5c7691dc876415bc9fc0ecf467e153` |
| Imported subtree tree | `cdb8cbcea1e83229f80620e4c281755d7614cb28` |
| Upstream commit subject/date | `fix(RcRef): keep idleTimeToLive when the value is 0 (#8202)`, `2026-09-12` |

`git -C repos/effect rev-parse --show-toplevel` points to Bridle. This is a squashed subtree, not an independent checkout whose local branch proves an upstream branch. Upstream `README.md:9-25,68-69` explicitly identifies `main` as v4 development and `v3` as the v3 branch. `packages/effect/package.json:1-5` identifies the exact release candidate. `MIGRATION.md` still says beta in places; that wording is stale relative to the manifest and README.

### Package layout and installation implications

| Local package | Public package | Version at pin | Role |
| --- | --- | --- | --- |
| `packages/effect` | `effect` | `4.0.0-rc.115` | Core, Schema, AI, HTTP, SQL interfaces, process interfaces |
| `packages/ai/openai` | `@effect/ai-openai` | `4.0.0-rc.115` | OpenAI Responses API model/client, embedding model, provider tools |
| `packages/ai/openai-compat` | `@effect/ai-openai-compat` | `4.0.0-rc.115` | Chat Completions-compatible model/client |
| `packages/ai/anthropic` | `@effect/ai-anthropic` | `4.0.0-rc.115` | Anthropic provider |
| `packages/ai/openrouter` | `@effect/ai-openrouter` | `4.0.0-rc.115` | OpenRouter provider |
| `packages/platform/node` | `@effect/platform-node` | `4.0.0-rc.115` | Node runtime and concrete OS services |
| `packages/platform/node-shared` | `@effect/platform-node-shared` | `4.0.0-rc.115` | Shared Node-compatible implementations |
| `packages/sql/sqlite-do` | `@effect/sql-sqlite-do` | `4.0.0-rc.115` | Durable Object SQLite adapter |

Evidence is each package's `package.json:1-12` and dependency sections. Provider directories are implementations, not a core `packages/ai/package.json`. The complete AI barrel, `packages/effect/src/unstable/ai/index.ts:1-95`, exports `LanguageModel`, `Chat`, `Tool`, `Toolkit`, `Prompt`, `Response`, `Model`, error/metadata/schema helpers and MCP modules. It does not export an `Agent` or turnkey operator runner.

Use normal published dependencies. Do not import or build Bridle against application source under `repos/`. Proposal: pin each selected Effect package to exactly `4.0.0-rc.115` and record the lockfile. Registry availability and published tarball contents were not checked here. Workspace manifests use `workspace:^` peers; do not copy those specifiers into Bridle. AI, HTTP, process, persistence, and SQL interfaces are under `unstable`. Upstream permits breaking changes there in minor releases, `MIGRATION.md:40-48`. Keep adapter contract tests alongside version upgrades.

The source checkout exports TypeScript under `src`; `publishConfig.exports` redirects published imports to `dist/*.js`. Core exports explicitly include `./unstable/ai`, `./unstable/http`, `./unstable/process`, `./unstable/persistence`, `./unstable/sql` and more. The wildcard permits public leaf imports such as `effect/unstable/ai/LanguageModel`. Core explicitly blocks root internals and CLI/cluster internals; provider exports block provider internals. `/index` paths are blocked. Do not infer that every internal file reachable through a wildcard is a supported application API. See `packages/effect/package.json:29-113`, `packages/ai/openai/package.json:27-56`.

### Correct imports

Source-backed import forms, not a dependency installation result:

```ts
import { Config, Context, Effect, Layer, ManagedRuntime, Schema } from "effect"
import { Chat, LanguageModel, Prompt, Tool, Toolkit } from "effect/unstable/ai"
import { FetchHttpClient } from "effect/unstable/http"
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai"

// Node-only composition:
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"

// Optional Durable Object SQLite implementation:
import { SqliteClient } from "@effect/sql-sqlite-do"
```

A barrel import gives a module namespace. For example, `LanguageModel.LanguageModel` is the service key, `OpenAiClient.OpenAiClient` is the client service class, and `SqliteClient.layer(...)` builds a layer. Public leaf namespace imports also work, such as `import * as LanguageModel from "effect/unstable/ai/LanguageModel"`.

Evidence: AI examples `ai-docs/src/71_ai/10_language-model.ts:7-12`, `20_tools.ts:7-10`; process example `ai-docs/src/60_child-process/10_working-with-child-processes.ts:6-8`; provider barrel `packages/ai/openai/src/index.ts:1-55`.

### Licenses and dependencies

Verified: Effect's root `LICENSE:1-21` is MIT, copyright Effectful Technologies Inc. The inspected core, provider, Node, and SQLite DO manifests declare MIT. Retain the required copyright/license notice when redistributing covered material. This says nothing about permission to use OpenAI services or a subscription account.

`effect` lists no runtime dependency or peer-dependency section. `@effect/ai-openai` and `@effect/sql-sqlite-do` depend on Effect through a peer and list no separate runtime SDK dependency. In particular, this OpenAI adapter is not a wrapper around the npm `openai` client. The DO driver imports Cloudflare types with `import type`; workers types are a development dependency.

Node adds real dependencies:

- `packages/platform/node/package.json:27-29,66-80`: Node `>=18.0.0`, runtime `@effect/platform-node-shared` and `undici:^8.10.2`, peers `effect` and `redis:>=5.0.0 <7.0.0`.
- `packages/platform/node-shared/package.json:75-78`: runtime `@types/ws:^8.18.1` and `ws:^8.21.3`.
- `pnpm-lock.yaml:6296-6298`: resolved `undici@8.10.2`, engine `>=22.19.0`.

Proposal: choose a supported Node release satisfying the transitive engine requirement, then validate the actual Bridle install. Redis is not thereby a Bridle product requirement. Check peer-install behavior and audit the final dependency licenses, because the subtree is not a complete license audit of installed transitive packages.

## 2. Services, layers, schemas, and errors

### Context, not ServiceMap

Verified constructor shape:

```ts
import { Context, Effect, Schema } from "effect"

class TaskStoreError extends Schema.TaggedError<TaskStoreError>()(
  "TaskStoreError",
  { message: Schema.String }
) {}

class TaskStore extends Context.Service<TaskStore, {
  append(event: unknown): Effect.Effect<void, TaskStoreError>
}>()("bridle/task/TaskStore") {}
```

This is a documentation-only API shape, not the proposed event schema. Real event input should use Bridle schemas rather than `unknown` after boundary decoding.

`Context.Service<Self, Shape>()("identifier")` defines a yieldable key. Use `const store = yield* TaskStore` in a generator. `TaskStore.of(implementation)` preserves the service shape. `TaskStore["Service"]` accesses its type. `Context.Service` also accepts a `make` option, but **does not synthesize a `.Default` layer**. Construct layers explicitly with `Layer.effect(TaskStore, makeTaskStore)` or `Layer.succeed(TaskStore, implementation)`.

Evidence: `packages/effect/src/Context.ts:201-303`; `LLMS.md:128-175`; `migration/services.md:1-208`. A targeted search found no `ServiceMap` in core source, LLMS, migration guides, or AI examples. `packages/effect/src/index.ts:117` exports `Context`. Advice using `ServiceMap.Service` is for a different revision and must not be applied to this pin.

`Layer.provide(dependencyLayer)` satisfies requirements without exposing the dependency as output; `Layer.provideMerge` also exposes it. A resource-acquiring effect passed to `Layer.effect` gets the layer's scope. Services should capture their dependencies during construction or explicitly declare method requirements. Toolkit handlers can capture services in `toLayer(Effect.gen(...))`; `Tool.make` also has a `dependencies` option for execution-time requirements.

Evidence: `ai-docs/src/01_effect/03_services/20_layer-composition.ts:26-70`; `ai-docs/src/01_effect/05_resources/10_acquire-release.ts:21-67`; `packages/effect/src/unstable/ai/Toolkit.ts:419-447`; `Tool.ts:1200-1273`.

Proposal: separate interfaces for task storage, conversation routing, Herdr sessions, plan-review exchange, artifact storage, and model access. The operator consumes those services; layer composition must not encode a predetermined plan/implement/review/fix sequence. Scope credential-bearing layers to the team workspace now, with workspace identity in their keys and configuration. Do not reuse one credential-capturing layer/memo map across future tenants by accident.

### Schema boundaries

Verified v4 forms:

- `Schema.Struct({ ... })`, `Schema.Class<Self>("identifier")({ ... })`, and `Schema.TaggedError<Self>()("Tag", { ... })`.
- `Schema.Literals(["a", "b"])` and `Schema.Union([A, B])`, with array arguments.
- `Schema.decodeUnknownEffect(SchemaValue)(input)` for untrusted values, `Schema.encodeEffect(SchemaValue)(value)` for encoded output. Errors are `Schema.SchemaError`.
- `typeof SchemaValue.Type`, `.Encoded`, `.DecodingServices`, and `.EncodingServices` distinguish domain values, wire values, and service requirements in each direction.
- `Schema.fromJsonString(schema)` handles JSON-string boundaries. `Schema.toCodecJson` supports deliberate JSON representations for richer types.
- `Schema.toJsonSchemaDocument(schema)` derives JSON Schema, but the Effect decoder remains authoritative. Provider JSON Schema may lose constraints.

Evidence: `ai-docs/src/01_effect/02_schema/10_schema-basics.ts:7-42`; `packages/effect/SCHEMA.md:116-167,4371-4537,4771-4839,5116-5143,6637-6790,6869-6919`; actual tool decoding and encoding in `Toolkit.ts:252-336,393-409`.

The Schema guide contains stale snippets. For example, `SCHEMA.md:96-107` imports `Getter`, `Parser`, and `Schema` from `effect/schema`. That path is not an export backed by `src/schema.ts` in this pin. The real root barrel exports `Schema`, `SchemaGetter`, `SchemaParser`, `SchemaTransformation`, and `JsonSchema` at `packages/effect/src/index.ts:287,527-557`. Prefer the current examples and source exports over copying that snippet.

For structured model output, `LanguageModel.generateObject({ prompt, schema, objectName })` returns `.value`, decoded by the selected codec. The OpenAI provider supplies `toCodecOpenAI`. It requires an object root without root `anyOf`, may rewrite optional properties as required nullable properties, and may omit unsupported constraints from the provider schema while retaining decoder checks. Design a containing object for tagged outcome unions rather than assuming every top-level union is accepted.

Evidence: `LanguageModel.ts:878-956`; `OpenAiStructuredOutput.ts:1-81`; `packages/ai/openai/src/OpenAiLanguageModel.ts:664-665`. Exact Bridle schemas still need provider fixture and live-model validation.

### Typed failures, defects, and interruption

Use typed errors for expected failures such as an unavailable agent session or rejected operation. Use `Effect.catch`, `catchTag`, and `catchReason`; do not copy v3's `catchAll` or `catchAllCause`. Defects and interruption are distinct from the typed error channel. V4 `Cause` contains a flat `reasons` array of `Fail`, `Die`, and `Interrupt`, not a recursive `Sequential`/`Parallel` tree.

`AiError.AiError` wraps `module`, `method`, and a tagged `reason`; it exposes `isRetryable` and `retryAfter`. Authentication, quota exhaustion, and malformed request errors should not be treated like transient transport failures. Source-defined retryability is advice about an error, not proof that repeating an entire tool-bearing turn is safe.

Evidence: `migration/error-handling.md:1-106`; `migration/cause.md:1-104`; `packages/effect/src/unstable/ai/AiError.ts:484-619,709-789,1562-1594`.

Proposal: return schema-backed operational failures to the operator when it can decide how to recover. Keep bugs, storage-integrity failures, and interruption visible to infrastructure monitoring. Do not convert cancellation to successful completion. Retry transport work under explicit limits; do not blindly retry a whole generation after a tool may already have changed the repository or created a session.

## 3. Tools, parallel work, and cancellation

### Tool contracts and handler layers

Verified tool-definition pattern, shown only as a design sketch:

```ts
const StartWork = Tool.make("StartWork", {
  description: "Start requested coding-agent work and return its durable operation handle",
  parameters: Schema.Struct({
    instruction: Schema.String,
    operationKey: Schema.String
  }),
  success: Schema.Struct({
    operationId: Schema.String,
    status: Schema.Literal("started")
  }),
  failure: Schema.Struct({
    code: Schema.String,
    message: Schema.String
  }),
  failureMode: "return"
})

const OperatorTools = Toolkit.make(StartWork)
// OperatorTools.toLayer({ StartWork: handler }) supplies the handler service.
// Inside Effect, yield* OperatorTools resolves a Toolkit.WithHandler.
```

`Tool.make` accepts a parameters schema, success schema, failure schema, description, handler dependencies, and optional approval requirement. Defaults are empty parameters, `Schema.Void` success, `Schema.Never` failure, and `failureMode:"error"`. Define explicit structured outputs for Bridle. A successful CLI exit string alone does not establish completion, approval, or a clean review.

`Toolkit.toLayer` registers typed handlers. A handler receives decoded parameters and `{ toolCallId?, preliminary }`. `preliminary(result)` takes the **success type**, so a progress/result union must be represented in that schema if the same tool reports both. `toolkit.handle(name, encodedParams, toolCallId?)` returns an **Effect containing a Stream**, not a final result. Consume it within a live effect/scope, for example via `Stream.unwrap` and `Stream.runCollect`; returning an unconsumed stream from a short-lived parent can strand or interrupt its handler.

Evidence: `Tool.ts:1200-1273`; `Toolkit.ts:90-132,172-225,341-412`; `ai-docs/src/71_ai/20_tools.ts:65-101`.

Failure modes matter:

- `"error"` propagates typed handler/parameter failures through the generation's error channel.
- `"return"` creates a failed tool-result for modeled failures so the next model turn can see it. Failure values still need to encode through the failure schema. Result encoding failures can fail the stream; defects and interruption are not universally converted to tool results.
- Tool results include `id`, `name`, `result`, `encodedResult`, `isFailure`, `preliminary`, and provider-execution information. Match by tool-call ID, not completion order or tool name.
- Do not assume `response.toolCalls[*].params` is already the domain value. This pin preserves wire parameters even when auto-resolution runs; the handler receives the decoded value. Upstream's transformer test retains `"21"` in the call and produces `42` from the handler. Some example comments call these parameters decoded, which is misleading for transforming schemas.

Evidence: `Toolkit.ts:317-409`; `Response.ts:1467-1529,1633-1685`; tests `Tool.test.ts:10-103,145-305`; `LanguageModel.test.ts:178-253` under `packages/effect/test/unstable/ai/`.

### What concurrent generation actually does

Verified in `LanguageModel.ts`:

| Operation | Behavior |
| --- | --- |
| `generateText` with toolkit | Calls the provider, validates response structure, resolves tools, collects final results, then returns. It does not automatically make the next model call. |
| `concurrency` omitted | Defaults to `"unbounded"` in both non-streaming and streaming resolution. |
| `generateText` progress | Preliminary tool results are filtered out of the returned response. |
| `streamText` progress | Emits preliminary and final results as they arrive. Tracks handler fibers with `FiberSet`, optionally bounds them with a semaphore, and emits finish after handlers complete. |
| Incomplete non-streaming response | Does not execute pending tools; synthesizes failure results. |
| Incomplete streamed response | Uses a one-chunk lookahead before starting tools; interrupts still-running handlers and synthesizes results for unresolved calls. Work already committed cannot be undone by this. |

Evidence: `LanguageModel.ts:1046-1050,1209-1273,1542-1716,2277-2370`. Test bodies inspected: `LanguageModel.test.ts:324-386,754-803,961-1135`; `Tool.test.ts:555-744`. They use mock providers, latches, queues, and `TestClock`, not remote coding agents.

Set a small explicit local concurrency limit for each operation class. Provider configuration such as OpenAI's `parallel_tool_calls` concerns what the model requests; it is not a replacement for the resolver's `concurrency` limit or repository/session locks.

### Long-running Herdr operations

Constraint: Herdr manages coding-agent terminal sessions in the task's Namespace dev box. Effect does not replace that session manager.

Proposal: favor `StartWork`, `ReadWorkStatus`, `CancelWork`, and `WaitForEvents` contracts over a tool that blocks for an entire implementation/review/fix cycle. Return an operation handle once a durable start record and session identity exist. The operator can start other work, inspect events, and decide whether to wait, cancel, request fixes, or commission another review.

A blocking tool remains useful for bounded operations. A blocked `chat.generateText` holds that chat's semaphore. Streaming progress is for a consumer to observe; `Prompt.fromResponseParts` excludes preliminary results from model history. It does not cause an overlapping operator model turn. Evidence: `Chat.ts:416-503`; `Prompt.ts:2155-2169`.

A task-level runner can own scoped fibers that observe Herdr sessions. Do not `forkChild` inside `StartWork`, return immediately, and expect the child to remain alive. Do not use `forkDetach` as persistence. A handle plus an external session and reconciliation record is what permits recovery after process loss.

### Scope and cancellation contract

Verified:

- `Effect.forkChild` attaches the new fiber to its parent; parent termination interrupts it.
- `Effect.forkScoped` ties a fiber to the current scope; `forkIn` targets an explicit scope.
- `Effect.forkDetach` removes parent-lifetime supervision but does not survive process loss.
- `Effect.acquireRelease(acquire, release)` registers cleanup if acquisition succeeds. Acquisition is uninterruptible by default; `{ interruptible:true }` changes that. Avoid placing an indefinite network wait inside default uninterruptible acquisition.
- `Effect.tryPromise({ try: signal => ..., catch: ... })` supplies an AbortSignal. The underlying operation only stops if it observes that signal. `Effect.callback` can return cancellation cleanup.
- `FetchHttpClient` forwards the HTTP client's abort signal to fetch. That does not prove cancellation of already accepted remote work.

Evidence: `Effect.ts:917-970,1200-1235,6521-6590,8534-8714`; implementation `internal/effect.ts:4106-4122,5418-5501`; `unstable/http/FetchHttpClient.ts:52-94`. The upstream streaming interruption tests above establish local handler behavior only.

Proposal: journal cancellation intent, interrupt the appropriate observer/tool fiber, explicitly request cancellation through the Herdr adapter, then persist observed termination or an unresolved status. Killing an HTTP request is not equivalent to killing a coding-agent session. Bridle must test process-tree cleanup, reconnects, late completion after cancellation, and a dev-box crash during cleanup. Scopes cannot guarantee finalizers after SIGKILL or host loss.

## 4. The operator loop belongs to Bridle

### Library support versus product work

Verified `LanguageModel.make` wraps one provider generation and its tool resolution. `Chat` supplies conversation history across successive calls. The actual agent-loop example is a user-written `while (true)` that calls `session.generateText`, continues when tools were requested, and returns otherwise. It is not a hidden framework agent loop.

Evidence: `LanguageModel.ts:1041-1273`; `Chat.ts:443-455`; `ai-docs/src/71_ai/30_chat.ts:106-135`. The tools example's comment at `20_tools.ts:130-132` says results are fed back automatically. Read narrowly: results are available for history/next-turn use, not an automatic second provider invocation within `generateText`.

`ExecutionPlan` is ordered resource/provider fallback with attempts and retry schedules. It is useful for model-call resilience, but is not an operator deciding which review or fix is needed. `effect/unstable/workflow` does contain durable workflow definitions, execution IDs, suspension and engine requirements. It is not automatically wired to Chat or Bridle's task Durable Object. Adopting it would need separate research and must not turn its deterministic handler into the workflow decision-maker.

Evidence: `ExecutionPlan.ts:1-8,92-115`; `ai-docs/src/71_ai/10_language-model.ts:40-55`; `unstable/workflow/Workflow.ts:1-12,45-93`.

### Required control boundary

Constraints:

- The AI operator decides transitions and the work to request, informed by task state, findings, human answers, and completed operations.
- Planning asks questions and obtains explicit human approval through Plannotator. The planner returns approved Markdown and does not implement.
- Implementation, specialist code reviews, regression reviews, architecture reviews, QA, and fix rounds have no routine human checkpoints.
- Humans perform final code review and merge. Bridle has no merge operation.
- The task Durable Object holds status and routes structured messages to and from the originating conversation. Anyone with access to that conversation can answer questions. Prototype review links are unguessable, task-scoped, and expiring.

Proposal for the driver:

1. Load the task checkpoint, operator history, and unconsumed external events.
2. Present those observations and available typed tools to the operator model.
3. Persist the model's requested actions and explicit decision record. A decision record is a concise outcome/reason/evidence reference, not a requirement to store hidden model reasoning.
4. Execute authorized requests through deterministic adapters. Append structured results and external observations.
5. Ask the operator what to do next, or honor its explicit wait/finish request subject to product invariants.

Deterministic code may enforce approval-before-implementation, reject merges, validate schemas, deduplicate commands, enforce budgets, persist events, wait for input, and route messages. It must not silently choose the next specialist, skip QA, repeat a fix round, or declare a task complete just because a status table advanced.

Do not copy the example's `toolCalls.length === 0` as Bridle's completion test. A text-only reply, provider truncation, unresolved approval, missing evidence, or an outstanding operation is not final task completion. Require an explicit schema-backed operator action and validate final-review readiness. `Response.FinishReason` distinguishes `stop`, `length`, `content-filter`, `tool-calls`, `error`, `pause`, `other`, and `unknown` at `Response.ts:2242-2291`.

### Manual dispatch option

`disableToolCallResolution:true` is a real option for collecting tool calls before dispatch. This can help Bridle persist model intent before invoking a side-effecting tool. The public `Toolkit.WithHandler.handle` then decodes/executes a persisted call, and `Prompt.fromResponseParts` can construct history from calls and final results.

There are two important limits:

- It disables resolution of **newly generated** calls. In this pin, already approved pending calls are pre-resolved earlier in the same generation path, before the disable flag is checked. Do not treat this flag as a universal no-side-effects mode when using Effect approval parts.
- Calling `toolkit.handle` directly performs parameter validation and handler execution, but does not perform `LanguageModel`'s approval evaluation. A manual dispatcher must enforce its own authoritative approval checks and account for provider-executed tools.

Evidence: `LanguageModel.ts:1070-1188,1217-1231`; `Toolkit.ts:272-409`; `LanguageModel.test.ts:200-227`. Proposal: compare auto-resolution with journaled handler wrappers against manual dispatch in a prototype. Neither is already Bridle's settled architecture.

Effect supports `needsApproval` and `tool-approval-request` / `toolApprovalResponsePart` messages. Those are protocol data, not Plannotator integration, authenticated approval storage, or bearer-link management. Test `Chat.test.ts:19-54` checks completed approvals are not repeated in one chat. It does not prove durable authorization or exactly-once execution across a crash.

## 5. Chat persistence versus a task checkpoint

### What Chat stores

Verified `Chat.empty`, `fromPrompt`, `fromExport`, and `fromJson` construct a chat with a `Ref<Prompt.Prompt>`. `export` and `exportJson` encode conversation history. Generation is serialized per Chat instance. Non-streaming history changes only after successful generation; streaming history collects emitted parts and updates in release/finalization, including partial output on failure or interruption.

Evidence: `Chat.ts:416-503,541,603,656-694`. `Prompt.fromResponseParts` turns calls into assistant messages and final local tool results into tool messages using their encoded results, `Prompt.ts:2021-2064,2155-2200`.

`Chat.layerPersisted({ storeId })` supplies `Chat.Persistence` through `BackingPersistence`. `get` and `getOrCreate` support chat IDs and optional TTL. A persisted chat has `.save`. Automatic generation wrappers call `saveChat` in `ensuring`, with `Effect.orDie`: persistence failures are defects rather than new typed errors on the generation API. Loading malformed stored history also dies.

Evidence: `Chat.ts:730-790,811-975`. Tests `Chat.test.ts:56-132` validate memory-store history and simulated TTL expiration. `BackingPersistence` supplies object get/set/getMany/setMany/remove/clear, not a transactional event append, compare-and-swap revision, or command deduplication contract, `unstable/persistence/Persistence.ts:99-132`.

Consequences for Bridle:

- A tool can commit a side effect before Chat stores the result. Retrying after a crash can execute it again.
- Two loaded Chat instances for one ID have different refs and semaphores. Persisted history is not a distributed single-writer lock. Whole-history saves can overwrite each other.
- Chat export is not a fiber continuation, a terminal session, or a task execution snapshot.
- Automatic saving is not atomic with an operation journal or outgoing message. Finalizer execution also cannot be assumed after host loss.
- Unlimited history growth, compaction, artifact retention, schema migration, and task-level recovery need explicit design.

### Proposed checkpoint and event contract

Persist domain records separately from the agent session:

| Record | Minimum useful fields to validate in a prototype |
| --- | --- |
| Task identity | Schema version, workspace/task ID, originating conversation reference, repository/revision, dev-box identity |
| Operator checkpoint | Checkpoint revision, model/provider identity, encoded history or history reference, last consumed event cursor, explicit decisions and evidence references |
| Operation journal | Operation ID, idempotency key, model call/turn ID and tool-call ID, requested parameters, requested/running/terminal status, Herdr session ID, attempts, result or error, cancellation intent |
| Planning/approval | Plan artifact reference and digest/revision, approval decision and provenance, outstanding question/review correlation, link expiry/revocation data where applicable |
| Findings and outputs | Structured review findings, QA/test evidence, approved Markdown reference, changed revision, artifact references, final-human-review status |
| Delivery | Incoming event identity/cursor, deduplication state, outgoing message identity and delivery status |

These are proposals, not finalized schemas or a new workflow state machine. Task status records the operator's actions and external facts. It does not choose transitions on the operator's behalf.

Prototype a single-writer/lease rule and transactional journal/checkpoint/outbox updates where storage allows them. Use durable operation identity beyond a model-supplied tool-call ID, since a retried model turn can emit a different ID for the same intent. Resume by reconciling known operation/session IDs before asking the operator to decide the next action. Unknown outcomes should remain explicit rather than being rewritten as success or automatically rerun.

`ResponseIdTracker` is only an optimization. It stores a `Map<object, string>` keyed by live prompt-message identity, not a durable session snapshot. JSON restoration replaces those objects. Persist sufficient full history and provider metadata for a non-incremental recovery path. The model wrapper can retry a stale incremental request with a full prompt, but that is not task recovery.

Evidence: `ResponseIdTracker.ts:1-8,47-50,81-138`; `LanguageModel.ts:1052-1068`; lifecycle tests `LanguageModelTrackerLifecycle.test.ts:48-169` and incremental failure tests `LanguageModel.test.ts:1322-1487` identify useful future regression cases.

## 6. OpenAI provider and subscription-backed Codex boundary

### Actual OpenAI behavior

`@effect/ai-openai` exposes a handwritten `OpenAiClient`, plus `Generated` and `OpenAiClientGenerated`. The language model consumes the handwritten client. Its main methods are `createResponse`, `createResponseStream`, and `createEmbedding`, with HTTP response metadata retained where relevant.

`OpenAiClient.make`:

- Requires `HttpClient.HttpClient`.
- Defaults to `https://api.openai.com/v1` and posts to `/responses` for text generation.
- Adds `Authorization: Bearer ...` only when `apiKey` is supplied.
- Can add organization/project headers, and supports `apiUrl` and `transformClient`.
- Applies `OpenAiConfig.withClientTransform` at request time after the construction-time transform.
- Maps transport, HTTP status, and decoding errors to `AiError`.

`OpenAiClient.layerConfig()` does **not** automatically read `OPENAI_API_KEY`. Only Config values explicitly passed to it are loaded. The documented wiring is:

```ts
const OpenAiClientLayer = OpenAiClient.layerConfig({
  apiKey: Config.Redacted("OPENAI_API_KEY")
}).pipe(Layer.provide(FetchHttpClient.layer))

const OperatorModelLayer = OpenAiLanguageModel.layer({
  model: "MODEL_ID"
}).pipe(Layer.provide(OpenAiClientLayer))
```

`MODEL_ID` is a placeholder, not a verified entitlement. `OpenAiLanguageModel.model(name, config?)` is an alternative that also supplies provider/model metadata. Its `.captureRequirements` captures the client dependency for use within a service.

Evidence: `packages/ai/openai/src/OpenAiClient.ts:53-87,123-149,191-259,356-428`; `OpenAiLanguageModel.ts:573-577,612-737`; core `Model.ts:34-51,89-97,130-155`. Mock HTTP tests inspected at `packages/ai/openai/test/OpenAiClient.test.ts:18-135,207-251` assert Bearer headers, URL overrides, transform precedence, explicit Config loading, and redaction.

`@effect/ai-openai-compat` is not an alternative subscription login. Despite method names like `createResponse`, its client posts to `/chat/completions`, `packages/ai/openai-compat/src/OpenAiClient.ts:177-247`. Choose it only for an actually compatible endpoint/protocol.

`Redacted` protects common formatting, not secret storage. The provider explicitly redacts organization/project headers in error contexts, with tests for authorization too. Tool execution annotates spans with parameters at `Toolkit.ts:275-278`. Proposal: keep tokens out of tool parameters, outputs, history, links, and task logs; audit custom headers and telemetry exporters. Workspace credentials should be injected by the runtime, not chosen by the model.

### What the pin does not supply

No subscription login, OAuth device/browser flow, credential-file loader, subscription-account selection, or token-refresh implementation was found in the handwritten OpenAI client/model. Occurrences of Codex model names, ChatGPT model names, or remote-MCP OAuth fields in generated schemas are not such an implementation.

The source verifies configurable transport, **not** that placing a ChatGPT access token into `apiKey` and changing the URL yields a working or permitted Codex integration. Header requirements, endpoint shape, allowed request fields, streaming protocol, refresh, account/workspace permissions, and policy must be verified independently. The sibling auth research owns OpenAI official policy; this document does not settle it or duplicate its conclusions.

### Public adapter boundaries

Three options exist at the Effect boundary, in increasing order of protocol responsibility:

1. Configure `OpenAiClient`'s URL/HTTP transforms if the authorized transport truly speaks its Responses API schema. Request headers alone do not solve incompatible bodies or events.
2. Supply an implementation of `OpenAiClient.OpenAiClient` that fulfills the public `Service` contract. This preserves the provider's prompt/tool/response conversion but still requires its `OpenAiSchema` shapes and HTTP response contracts.
3. Implement a custom `LanguageModel.LanguageModel` using `LanguageModel.make`. This avoids pretending a Codex bridge is identical to OpenAI's public Responses transport.

The third option has this hook contract from `LanguageModel.ts:790-811`:

```ts
import type { Effect, Stream } from "effect"
import type { AiError, IdGenerator, Response } from "effect/unstable/ai"
import { LanguageModel } from "effect/unstable/ai"

declare const generateText: (
  options: LanguageModel.ProviderOptions
) => Effect.Effect<Array<Response.PartEncoded>, AiError.AiError, IdGenerator.IdGenerator>

declare const streamText: (
  options: LanguageModel.ProviderOptions
) => Stream.Stream<Response.StreamPartEncoded, AiError.AiError, IdGenerator.IdGenerator>

const makeAdapter = LanguageModel.make({ generateText, streamText })
```

These declarations illustrate the boundary without implementing or running it. An optional `codecTransformer: LanguageModel.CodecTransformer` customizes structured-output conversion. `make` returns `Effect.Effect<LanguageModel.LanguageModel>`. Use `Layer.effect(LanguageModel.LanguageModel, makeAdapter)` to provide it. Capture bridge services in the outer constructor effect; the provider hooks' declared runtime requirement is `IdGenerator`, not arbitrary Bridle services.

`ProviderOptions` carries normalized `Prompt`, tools, tool choice, text/JSON response format, span, previous response ID, and incremental prompt, `LanguageModel.ts:693-756`. The adapter returns **encoded Effect response parts**, not arbitrary SDK objects, text logs, or promises. The wrapper then performs schema conversion/decoding, tool resolution, and standard response construction. Upstream's fake model exercises this exact boundary at `packages/effect/test/unstable/ai/utils.ts:1-56`.

Proposal: make a subscription-backed Codex bridge a separate adapter with its own versioned protocol fixtures and credential service. Whether the underlying authorized interface is an SDK, subprocess protocol, or another documented transport is not decided by Effect. If the bridge only returns a completed coding-agent run, it is more naturally a Bridle tool. To act as the **operator model**, it must expose model turns and structured tool requests/results under Bridle's control rather than hiding all decisions and execution inside an opaque terminal transcript.

Bridge validation must cover:

- Distinct model text, complete tool calls, partial tool arguments, final tool results, finish reason, usage, and provider metadata.
- Stable call/session IDs, restart behavior, cancel acknowledgment, and whether interrupted external work continues.
- JSON-output capability or an explicit typed unsupported-feature failure. Do not claim `generateObject` compatibility from a TypeScript cast.
- Preservation of metadata needed on subsequent turns. The provider already handles encrypted reasoning content for some non-stored reasoning requests, `OpenAiLanguageModel.ts:831-843`. The generated API has assistant `phase` documentation at `Generated.ts:3130-3134`, but a targeted search found no `phase` handling in handwritten `OpenAiLanguageModel.ts` or `OpenAiSchema.ts`. Treat phase round-tripping as a specific gap to test, not a verified compatibility feature.
- Auth expiration, refresh contention, account revocation, rate/quota errors, and prevention of credentials crossing workspace boundaries. Auth policy and entitlements remain prerequisites.

## 7. Node dev box versus Cloudflare Durable Objects

### Proposed runtime placement

| Concern | Node in task dev box | Task Durable Object |
| --- | --- | --- |
| Operator driver | Proposed home for the long-running agent and session observers | Status/router by constraint; could host bounded model turns only after a runtime spike |
| Coding-agent terminals | Herdr adapter, filesystem/process access where needed | Route commands/events; do not assume local OS process services |
| Effect execution | `NodeRuntime.runMain`, task-scoped layers/fibers | `ManagedRuntime` or a bounded provided Effect at web-handler boundaries |
| Durable state | Checkpoint through task storage protocol, reconnect/reconcile | Persist status, message correlation, operation/checkpoint records as designed |
| Provider transport | Fetch; optional Node WebSocket implementation | Fetch is a plausible shared transport; built-in OpenAI WebSocket assumptions do not match a generic edge runtime |

The operator location is a proposal. The user requires the task dev box and per-task Durable Object, but has not thereby approved every placement choice above.

Verified Node support:

- `NodeRuntime.runMain` uses the shared runner, which registers SIGINT/SIGTERM listeners and interrupts the root fiber. It is a process lifecycle API, not a Durable Object runner. Evidence: `packages/platform/node/src/NodeRuntime.ts:1-53`; `packages/platform/node-shared/src/NodeRuntime.ts:35-58`.
- `NodeServices.layer` supplies child-process spawning, crypto, filesystem, path, stdio, and terminal services. It does **not** supply the OpenAI client's HTTP dependency. Evidence: `packages/platform/node/src/NodeServices.ts:11-50`.
- Process definitions live in `effect/unstable/process`; Node supplies their implementation. `spawn` yields a scoped process handle and supports streaming output/exit observation. Evidence: `ai-docs/src/60_child-process/10_working-with-child-processes.ts:64-110`.
- V4 documents a core fiber keep-alive timer, `migration/fiber-keep-alive.md:1-74`. Keeping a Node event loop alive is not durable task storage or a Cloudflare host-lifetime guarantee.

### ManagedRuntime is integration, not durable execution

Verified `ManagedRuntime.make(layer)` accepts a layer with no remaining requirements, builds/caches its context, owns scopes, and provides `runPromise`, `runPromiseExit`, `runFork`, and `dispose`. Calls are attached to its scope. `runPromise(effect, { signal })` can connect an incoming request's cancellation to an effect; `dispose()` closes the runtime scope and its resources.

Evidence: `ManagedRuntime.ts:285-387`; integration example `ai-docs/src/04_integration/10_managed-runtime.ts:67-84,121-129`. That example uses Hono and Node signals; it is not a Cloudflare Durable Object test.

Proposal: use an object-local runtime/layer factory for object-bound services, never a global layer capturing one object's storage or another workspace's credentials. Keep request completion and task cancellation separate. A disconnected status client must not automatically cancel the task operator.

Unvalidated: this research did not run workerd/Wrangler or verify current Cloudflare lifecycle limits. Do not assume in-memory `Ref`, queues, suspended fibers, `Effect.sleep`, detached work, or cleanup finalizers survive eviction/restart. Persist wait intent and event cursors; use Cloudflare-supported wakeup/delivery mechanisms after the platform research validates them. Test abort behavior, isolate construction restrictions, request/response streams, and layer disposal without Node APIs before selecting a DO execution pattern.

### Actual DO SQLite integration

There is a public driver, `@effect/sql-sqlite-do`, rather than a hypothetical need to invent one. Its concrete layer shape is:

```ts
SqliteClient.layer({ storage: ctx.storage })
```

This provides both the package-specific `SqliteClient` and generic `effect/unstable/sql/SqlClient`. `ctx.storage` denotes a Durable Object's storage here; the snippet is not a tested DO implementation.

Verified at `packages/sql/sqlite-do/src/SqliteClient.ts:99-107,123-169,178-194,305-349`:

- `db: ctx.storage.sql` is sufficient for ordinary SQL access.
- Transactions require the full `storage: ctx.storage`; supplying only `db` makes `withTransaction` fail explicitly.
- Storage-backed transactions call `storage.transaction`, roll back failed effects, and serialize through a semaphore. Nested transactions are rejected.
- Missing both storage forms is a defect. Blob values are normalized to `Uint8Array`; `updateValues` is unsupported.
- Keep transactions short. Do not hold one across a model call, Plannotator approval, or terminal wait.

Tests `packages/sql/sqlite-do/test/Client.test.ts:238-335` cover commit, typed failure rollback, interruption rollback, rejected nesting, and migrations, but use `FakeDurableObjectStorage`. They are not proof of live Cloudflare semantics.

`Persistence.layerBackingSql` can in principle supply Chat's `BackingPersistence` over a SQL client. However, it creates a table/index and starts a scoped TTL-cleanup fiber repeating every five minutes, `packages/effect/src/unstable/persistence/Persistence.ts:521-620,671-685`. That is not automatically appropriate for a hibernating object. Prototype a bounded/custom backing store or an explicit cleanup strategy instead of assuming generic SQL persistence needs no lifecycle work. It still would not provide Bridle's operation journal and atomic task checkpoint.

### Fetch and WebSocket limits

`FetchHttpClient.layer` uses `globalThis.fetch` or an injected fetch implementation and has no Node import in its implementation. This supports a shared HTTP interface across Node and edge code, subject to runtime behavior. It strips `content-length`, passes AbortSignal, and uses Web Streams with `duplex:"half"` for streaming request bodies, `FetchHttpClient.ts:1-8,29-31,52-94,112-125`. Actual bundle compatibility and streaming behavior remain unvalidated.

OpenAI's optional `withWebSocketMode`/`layerWebSocketMode` documents only `NodeSocket.layerWebSocketConstructorWS` and `BunSocket.layerWebSocketConstructor`, because it needs non-standard constructor options for Authorization headers. Evidence: `packages/ai/openai/src/OpenAiClient.ts:697-759`. Do not promise this mode in Durable Objects by substituting the browser/global WebSocket constructor. A custom edge transport would be a separate spike.

## 8. Dependency and API mistakes to avoid

- Installing `effect@3`, mixing independently versioned v3 provider/platform packages with this v4 pin, or assuming every v4 prerelease shares these APIs.
- Importing core AI from `@effect/ai`, HTTP from `@effect/platform`, process APIs from the old `Command` module, or provider code from Bridle's vendored source.
- Treating `packages/ai` as an empty/incomplete AI SDK because it contains only provider directories. The implementation is in core `unstable/ai`.
- Using `ServiceMap`, `Context.Tag`, `Context.GenericTag`, `Effect.Service`, auto-generated `.Default` layers, or `Runtime<R>` from other revisions. This pin uses `Context.Service`, explicit layers, and Effect run functions/ManagedRuntime.
- Copying stale Schema imports from `effect/schema`; assuming v3 Schema unions, parsing names, or error types apply unchanged.
- Expecting `NodeRuntime.runMain` to provide services, or `NodeServices.layer` to provide `HttpClient`.
- Assuming `OpenAiClient.layerConfig()` reads credentials automatically, that `apiKey` proves a token is authorized, or that `openai-compat` implements subscription auth.
- Calling `toolkit.handle` as if it returns a final value, assuming returned call parameters are domain-decoded, or matching concurrent results by position.
- Leaving tool concurrency unbounded by accident, or using `forkDetach` as a durable job queue.
- Treating `disableToolCallResolution` as bypassing all earlier pending-approval execution, or direct `handle` as enforcing model-level approvals.
- Treating Chat persistence, response IDs, SQL transactions, or Workflow definitions as a ready-made durable operator.
- Assuming MIT licensing settles hosted-service policy, or Node `>=18` is enough for the pinned transitive dependencies.

## 9. Prototype validation spikes

None of these spikes was executed in this research.

| Priority | Spike | Required evidence |
| --- | --- | --- |
| 1 | Published v4 dependency/import check | Install exact pins outside `repos/`; lock dependency graph; compile a minimal service/layer, Schema boundary, toolkit, model layer, and Node entrypoint. Verify tarball exports, transitive engines, peer behavior, and licenses. |
| 1 | Agent-owned operator turn loop | A fake `LanguageModel.make` chooses different next actions from the same status given different findings. Verify the driver only executes decisions, enforces approval/no-merge constraints, and handles explicit wait/final-review actions. Add real-model evaluation separately. |
| 1 | Crash-consistent tool dispatch | Crash before/after intent persistence, session start, result persistence, and chat save. Reconcile using operation/session IDs without duplicate side effects. Compare automatic resolution with journaled wrappers against manual dispatch. |
| 1 | Parallel long-running work | Run bounded mock tools, then Herdr sessions. Observe completion-order independence, progress, one tool failing, provider stream failure, incomplete finish, operator cancellation, process exit, and late remote completion. Verify explicit cancel acknowledgment. |
| 1 | Codex bridge contract | After auth/policy feasibility is established, obtain authorized protocol fixtures. Map full/streamed turns, encoded tool parameters, results, metadata, usage, errors and cancellation through `LanguageModel.make`. Demonstrate the operator retains decision control. |
| 1 | Durable Object runtime/storage | Run the chosen layers in workerd/Wrangler and a real DO. Validate bundle imports, fetch/SSE/abort, initialization, concurrent messages, transactions and rollback, restart recovery, storage isolation, cleanup strategy, and supported wakeups. Mock driver tests alone do not pass this spike. |
| 2 | Structured state/tool schemas | Round-trip checkpoint and tool success/failure data; reject malformed events; validate OpenAI codec rewrites, root shape, unsupported constraints, and schema-version migration. Confirm model sees recoverable failures as structured tool results. |
| 2 | Chat recovery/retention | Test interrupted streams, failed automatic saves, simultaneous loads of one chat ID, full-history fallback after restart, metadata/phase preservation, compaction, artifact references, and bounded history size. |
| 2 | Human-message and plan-review boundary | Correlate questions, answers and approval with task/plan revision; test expiring bearer links, duplicate delivery, reconnects, and stale approvals. Ensure only approved Markdown reaches the operator and the planner does not implement. |
| 2 | Security and observability | Assert tokens never appear in prompts, tool parameters/results, event records, logs, traces, or URLs. Verify workspace isolation, structured decision/finding audit records, retry budgets, and final human-review readiness without a merge capability. |

The next implementation decision should follow the crash-consistent dispatch and Codex/DO spikes. The source supports the required typed interfaces and agent-turn construction. It does not yet establish Bridle's durable orchestration or subscription-backed operator feasibility.

# System design

How Notus works as built at commit `4cd36b9` (2026-09-15), from the system context down to the wire between the dev box and its Task object. [Architecture rules](CONTEXT.md) own conventions, the [codebase proposal](../plans/codebase.md) owns ownership, and the slice plans own each increment's scope and validation: [operator](../plans/operator.md), [repository](../plans/repository.md), [platforms](../plans/platforms.md), [dashboard](../plans/dashboard.md).

## Contents

1. [Primitives](#primitives)
2. [System context](#1-system-context)
3. [Code tiers](#2-code-tiers)
4. [Hosts, responsibilities and secrets](#3-hosts-responsibilities-and-secrets)
5. [The platform seam](#4-the-platform-seam)
6. [One task end to end](#5-one-task-end-to-end)
7. [Intake: any platform to the Task object](#6-intake-any-platform-to-the-task-object)
8. [Inside the Task object: the alarm pass](#7-inside-the-task-object-the-alarm-pass)
9. [Operator turns, steps and the model broker](#8-operator-turns-steps-and-the-model-broker)
10. [Tool calls become durable work](#9-tool-calls-become-durable-work)
11. [Dev box provisioning](#10-dev-box-provisioning)
12. [Dev box and Task object: enrollment, readiness, commands](#11-dev-box-and-task-object-enrollment-readiness-commands)
13. [Specialist rounds](#12-specialist-rounds)
14. [Repository access and pull requests](#13-repository-access-and-pull-requests)
15. [Pull request feedback continues the task](#14-pull-request-feedback-continues-the-task)
16. [Answers back to the platform: the delivery outbox](#15-answers-back-to-the-platform-the-delivery-outbox)
17. [Dashboard: sign-in, workspaces and installs](#16-dashboard-sign-in-workspaces-and-installs)
18. [Claims, leases and fences](#17-claims-leases-and-fences)
19. [Storage map](#18-storage-map)
20. [Not built yet](#19-not-built-yet)

## Primitives

| Primitive          | What it is                                                                                                                           | Where it lives                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Stage              | One deployment: a developer's own (`$USER`) or `production`, each with its own Workers, databases, objects and `notus.run` hostnames | Alchemy stack                                              |
| Workspace          | A team's configuration and access boundary: members with roles, installations, scopes, dev box environment                           | Shared D1                                                  |
| Platform           | A system humans talk through: `slack` or `github`. One adapter per platform implements the `@notus/platform` contract                | Code: `@notus/platform-slack`, `@notus/platform-github`    |
| Installation       | A platform connected to one workspace: a Slack team with its bot token, a GitHub App installation                                    | D1 `workspace_installations`                               |
| Scope              | A place the workspace covers inside an installation: a channel, a repository                                                         | D1 `workspace_scopes`                                      |
| Source             | A conversation address: `platform, installationId, scope, conversation` (a thread, a pull request number)                            | Inputs, routes, task sources                               |
| Input              | One verified, platform-neutral message with an actor, reply target, start intent and `root` flag                                     | D1 inbox, then the Task object                             |
| Route              | Binds one conversation to one task ID and its initiator. A task owns its origin thread and any attached pull request                 | D1 `inbox_routes`                                          |
| Task               | The authoritative record of one piece of work: origin and attached sources, inputs, answer obligations, responses                    | One Task Durable Object per task ID                        |
| Attempt            | One assignment of the task to an execution mode (`simulation`, `readiness`, `operator`); one active per task                         | Task object                                                |
| Invocation         | One operator turn, created for exactly one admitted human input                                                                      | Task object                                                |
| Step               | One persisted model round inside a turn; may end in text or in unresolved tool calls                                                 | Task object                                                |
| Command            | Durable work a tool call needs: `shell`, `checkout`, `push`, `specialist` run on the box; `pull-request` runs in control             | Task object                                                |
| Provisioning state | The dev box's lifecycle: phase, provider resource, runtime epoch, readiness                                                          | Task object                                                |
| Capability         | An HMAC-signed bearer token (`nr1.`) naming the task binding it authorizes: Enrollment or Readiness                                  | Issued by the Task object's host, held by the box          |
| Delivery           | An outbox row for one reaction or answer, sent through the platform registry, with its own claim and outcome                         | Task object                                                |
| Connection         | One saved model login. `userId` serves the operator; `agent:userId` serves Codex on the box                                          | One Connection Durable Object per name                     |
| Canonical user     | The Notus user a Slack mention or dashboard sign-in resolves to; Better Auth users map onto it through `account_logins`              | Shared D1, plus Better Auth tables in `AuthDb`             |
| Operation ID       | The idempotency key of an external effect: a model forward, a provisioning create                                                    | Step, provisioning state                                   |
| Gate               | `blockConcurrencyWhile`: short, local, synchronous-SQLite critical sections. Network work never runs inside it                       | Task and Connection objects                                |
| Claim / lease      | Take work under a gate with an expiry, do it outside, record it only if the claim still matches                                      | Everywhere, see [section 17](#17-claims-leases-and-fences) |

## 1. System context

Who talks to whom. Every arrow is a real network call. Hostnames are per stage: `<stage>.notus.run` for the dashboard and `api.<stage>.notus.run` for the API, or `notus.run` and `api.notus.run` in production.

```mermaid
flowchart LR
  human(["Team member"])
  admin(["Workspace admin"])
  subgraph slack["Slack"]
    thread["Channel thread"]
  end
  subgraph cf["Cloudflare: one Alchemy stage"]
    dash["Dashboard Worker<br/>TanStack Start"]
    worker["Api Worker<br/>events, auth, installs,<br/>runtime, cron, RPC"]
    d1[("Shared D1<br/>workspaces, installations,<br/>identities, sign-ins, inbox, routes")]
    task["Task Durable Object<br/>one per task"]
    conn["Connection Durable Objects<br/>userId and agent:userId"]
  end
  subgraph ns["Namespace"]
    box["Dev box VM<br/>supervisor, Herdr, Codex,<br/>git, bash"]
  end
  openai["OpenAI<br/>Responses API, ChatGPT"]
  github["GitHub<br/>Notus App, repositories"]

  human -->|"mentions and replies"| thread
  thread -->|"POST /slack/events"| worker
  human -->|"PR comments and reviews"| github
  github -->|"POST /github/events"| worker
  admin -->|"browser"| dash
  dash -->|"service binding: /auth/* and RPC"| worker
  worker <--> d1
  worker -->|"DO RPC"| task
  task -->|"read installation credentials"| d1
  task -->|"reactions and thread replies"| thread
  task -->|"forward model request, agent login"| conn
  conn -->|"adds bearer"| openai
  task -->|"Create, Activate, Fetch"| ns
  box -->|"HTTPS /runtime/* poll"| worker
  box -->|"Codex with a one-round login"| openai
  task -->|"scoped tokens, open PR, comments"| github
  box -->|"git clone and push with a one-shot token"| github
  human -->|"reviews and merges"| github
```

The dev box and the dashboard never accept inbound connections from Notus. The box dials the Worker, and the Worker routes each call to the Task object named inside the signed capability. The dashboard reaches the API only through its service binding.

## 2. Code tiers

Imports only point downward or sideways. Arrows are real `@notus/*` imports in `src/`.

```mermaid
flowchart TB
  root["alchemy.run.ts<br/>Api and Dashboard resources"]
  subgraph t4["Tier 4 apps: startup, bindings, configuration"]
    api["apps/api<br/>Worker and DO declarations, Better Auth,<br/>platform adapters for the host ports"]
    dashboard["apps/dashboard<br/>TanStack Start, shadcn, TanStack DB"]
    devbox["apps/devbox<br/>Bun supervisor, Docker image"]
  end
  subgraph t3["Tier 3 entrypoints: cross-domain use cases"]
    control["@notus/control<br/>hosts (Api, Task, Connection, Build),<br/>inbox, use cases, ingress, broker,<br/>runtime auth, protocol, server, client"]
    operator["@notus/operator<br/>prompt, tools, one model round"]
  end
  subgraph t2["Tier 2 domains: product decisions"]
    tasks["@notus/tasks<br/>State"]
    executions["@notus/executions<br/>Attempts, Steps, Commands,<br/>Provisioning, Devbox"]
    accounts["@notus/accounts<br/>Identities, Connections"]
    workspaces["@notus/workspaces<br/>Workspaces, Access,<br/>Credentials, Environments"]
    platforms["@notus/platforms<br/>registry"]
    pslack["@notus/platform-slack<br/>adapter"]
    pgithub["@notus/platform-github<br/>adapter"]
  end
  subgraph t1["Tier 1 packages: vocabulary and provider SDKs"]
    platform["platform<br/>contract, ids, descriptors"]
    contracts["contracts<br/>json"]
    stages["stages<br/>hostnames"]
    db["db<br/>schemas, relations, migrations,<br/>Shared, Task and Connection stores"]
    cloudflare["cloudflare<br/>sealing"]
    slackp["slack"]
    githubp["github"]
    namespacep["namespace"]
    openaip["openai"]
    herdrp["herdr"]
  end

  root --> api
  root --> stages
  api --> control & db & cloudflare & stages
  dashboard -.->|"type only"| api
  devbox --> control & executions & herdrp
  control --> operator & tasks & executions & accounts & workspaces & platforms
  control --> platform & cloudflare & db & pslack & pgithub & githubp & openaip
  tasks --> executions
  executions --> workspaces & namespacep & contracts
  accounts --> openaip
  workspaces --> contracts
  platforms --> platform
  pslack --> platform & slackp
  pgithub --> platform & githubp
  tasks & executions & accounts & workspaces --> platform
  tasks & executions & accounts & workspaces --> db
  namespacep --> contracts
```

`@notus/platform` depends on `effect` only, so descriptors can be imported anywhere. `@notus/slack` and `@notus/github` know nothing about Notus. Only the two adapter domains import them for sources, and entrypoints only see `@notus/platforms`. The dashboard imports the API's type for its RPC client, never its code.

## 3. Hosts, responsibilities and secrets

Five runtime hosts. The main design constraint is where each credential can and cannot exist.

```mermaid
flowchart TB
  subgraph dash["Dashboard Worker"]
    d1n["Pages, server functions, optimistic collections"]
    d2n["Forwards /auth/* and cookies to the API"]
    dsn["Holds: nothing secret. Never sees provider tokens"]
  end
  subgraph worker["Api Worker: stateless, per request"]
    w1["/slack/events, /github/events through the platform registry"]
    w2["Durable inbox admit, cron drain every minute"]
    w3["/runtime/* routed by verified capability"]
    w4["/auth/* Better Auth, /platforms/:platform/install callbacks"]
    w5["dashboard RPC: every call resolves the session itself"]
    wsn["Holds: Slack signing secret and OAuth client, GitHub webhook secret,<br/>GitHub OAuth client and App key, runtime HMAC keys, Better Auth secret"]
  end
  subgraph taskdo["Task Durable Object: one per task ID"]
    t1["Authoritative task, sources, obligations"]
    t2["Operator loop, tool dispatch, settlement"]
    t3["Provisioning, runtime enrollment, commands"]
    t4["Pull request actions, delivery outbox"]
    tsn["Holds: GitHub App key, runtime HMAC keys.<br/>Reads installation and devbox provider credentials from D1 per use.<br/>Never a model token."]
  end
  subgraph conndo["Connection Durable Objects"]
    c1["userId: operator login, idempotent forward"]
    c2["agent:userId: Codex login, refresh before a round"]
    csn["Holds: OpenAI access, refresh and ID tokens, or an API key"]
  end
  subgraph box["Dev box: Namespace VM, user devbox uid 1001"]
    b1["Enroll, report readiness, poll commands"]
    b2["bash, git, Codex agents in Herdr panes"]
    bsn["Holds: its runtime capability in a 0600 journal.<br/>A GitHub token inside one git process.<br/>A Codex login without refresh token for one round."]
  end

  dash -->|"service binding"| worker
  worker -->|"getByName(taskId)"| taskdo
  taskdo -->|"getByName(initiatorId or agent:initiatorId)"| conndo
  box -->|"bearer capability"| worker
```

## 4. The platform seam

Core code never branches on `slack` or `github`. The Worker and the Task object each build one registry from the deployed adapters. Everything platform-specific happens behind it: verifying and normalizing webhooks, installing, listing scopes, deciding who may participate, and resolving reply handles.

```mermaid
flowchart LR
  subgraph contract["@notus/platform: the contract"]
    ids["InstallationId, PlatformId<br/>branded opaque strings"]
    src["Source, ReplyTarget, Actor,<br/>Received, Input, Reservation"]
    caps["Capabilities<br/>input:start, input:message, input:review,<br/>output:update, output:reply, output:react,<br/>scope:list, conversation:open"]
    desc["PlatformDescriptor<br/>name, icon, scope noun, capabilities"]
    adapter["PlatformAdapter<br/>ingress.receive, installing.begin and complete,<br/>forInstallation"]
    surfaces["InstallationSurfaces<br/>scopes.list, conversations.resolveReply,<br/>identity.mayParticipate"]
  end
  subgraph registry["@notus/platforms registry"]
    fp["forPlatform(platform)<br/>descriptor, ingress, installing"]
    fi["forInstallation(ref)<br/>descriptor + surfaces"]
  end
  subgraph slackA["platform-slack"]
    sa["channel = scope, thread ts = conversation,<br/>message ts = target. Bot token per team<br/>from InstallationCredentials"]
  end
  subgraph githubA["platform-github"]
    ga["owner/name = scope, PR number = conversation,<br/>comment or review = target. App bound per installation.<br/>Only write collaborators participate"]
  end
  adapter --> surfaces
  sa -->|"implements"| adapter
  ga -->|"implements"| adapter
  registry -->|"built from"| slackA & githubA
  ingressR["Worker ingress"] --> fp
  installR["Worker install route"] --> fp
  deliverR["Task delivery"] --> fi
  dashR["dashboard scope lists"] --> fi
  inboxR["Inbox admit: input:start check"] --> fp
```

| Capability          | Slack | GitHub | Meaning in practice                                              |
| ------------------- | ----- | ------ | ---------------------------------------------------------------- |
| `input:start`       | yes   | no     | Only a Slack mention can start a task                            |
| `input:message`     | yes   | yes    | Replies in an attached conversation are inputs                   |
| `input:review`      | no    | yes    | Review comments and reviews are inputs                           |
| `output:update`     | yes   | no     | Progress goes to the Slack origin thread only                    |
| `output:reply`      | yes   | yes    | Answers land on the input's own target                           |
| `output:react`      | yes   | yes    | Eyes reaction as receipt; GitHub reviews themselves cannot react |
| `scope:list`        | yes   | yes    | The dashboard picker lists channels or repositories              |
| `conversation:open` | no    | yes    | Notus opens pull requests                                        |

## 5. One task end to end

The live path: a Slack mention, a specialist round, a pull request, a review comment on GitHub and the follow-up. Later sections open each box.

```mermaid
sequenceDiagram
  autonumber
  actor U as Initiator
  participant S as Slack
  participant W as Api Worker
  participant D as Shared D1
  participant T as Task DO
  participant C as Connection DOs
  participant O as OpenAI
  participant B as Dev box
  participant G as GitHub

  U->>S: @Notus fix the README typo
  S->>W: POST /slack/events
  W->>D: installation to workspace, scope covered, insert inbox message
  W-->>S: 200
  W->>D: drain: claim message, reserve route and task ID
  W->>T: admit, then prepareEnvironment
  T->>S: eyes reaction
  T->>C: forward step 0 for userId
  C->>O: POST /responses
  O-->>T: create_devbox
  Note over T,B: Namespace Create and Activate, box enrolls and reports ready
  O-->>T: checkout_repository
  B->>W: poll, receives checkout plus a Contents read token
  B->>G: git clone
  O-->>T: run_specialist agent implementer
  T->>C: agentLogin for agent:userId
  B->>W: poll, receives the round plus a Codex login file
  B->>O: Codex works in the checkout, writes a report
  B->>W: observe report
  O-->>T: push_branch, then create_pull_request
  B->>G: git push login/slug
  T->>G: open PR, then route its conversation to this task
  O-->>T: final text with the PR link
  T->>S: reply in the thread
  U->>G: review comment on the PR
  G->>W: POST /github/events
  W->>T: attachConversation: did you open this PR?
  T-->>W: yes, initiator and start time
  W->>D: route the PR to the task, insert inbox message
  W->>T: admit as a new input on the attached source
  Note over T,G: New operator turn: edits, push_branch to the same branch
  T->>G: threaded reply to the review comment
  U->>G: merge
```

## 6. Intake: any platform to the Task object

Intake is two-phase on purpose. The webhook request only commits a durable inbox row, so the platform gets its acknowledgement fast. A separate drain, started with `waitUntil` right away and repeated by cron every minute, moves rows into Task objects. One route, `/<platform>/events`, serves every platform (`entrypoints/control/src/ingress.ts`).

```mermaid
sequenceDiagram
  autonumber
  participant P as Slack or GitHub
  participant R as Worker ingress route
  participant A as Adapter via registry
  participant I as control Inbox
  participant Acc as workspaces Access
  participant T as Task DO
  participant D as D1

  P->>R: POST /platform/events, raw body and headers
  R->>A: ingress.receive: verify signature, decode, normalize
  A-->>R: acknowledge challenge, ignored (bot, self, unknown team), or Received plus optional task claim
  R->>Acc: workspaceOf(platform, installationId)
  Note over R: no workspace: 200, ignored as foreign-installation
  R->>Acc: covers(workspace, scope)
  Note over R: scope not covered: 200, ignored before any provider call
  R->>A: forInstallation, identity.mayParticipate(actor, scope)
  Note over A: Slack: always. GitHub: collaborator role admin, maintain or write
  opt Received carries a task claim and the conversation has no route
    R->>T: attachConversation(source)
    T-->>R: confirmation or null
    R->>D: insert route for the PR, initialized, ON CONFLICT DO NOTHING
  end
  R->>I: admit(input)
  I->>I: reject startIntent unless the descriptor has input:start
  I->>I: derive keys from platform, installation, scope, conversation, target
  I->>Acc: authorizeSource
  opt startIntent and no route yet
    I->>D: resolve actor to canonical user, authorizeStart membership
  end
  I->>D: batch upsert inbox_envelopes and inbox_messages
  R-->>P: 200
  R->>I: waitUntil drain

  loop drain pass, at most 25 due messages
    I->>D: UPDATE message SET state sending, token, generation+1, recoverAt now+60s
    alt no route and message has an initiator
      I->>D: INSERT inbox_routes with new task ID, ON CONFLICT DO NOTHING
    end
    alt route not initialized and this is not its start message
      I->>D: back to pending, due in 1s
    else message older than the conversation's start
      I->>D: state context
    else
      I->>T: admit(Admission)
      opt needsEnvironment
        I->>T: prepareEnvironment(environment, repository)
      end
      I->>D: fenced batch: route initialized, message done
    end
  end
```

The route decides task identity. A Slack start mention creates the route, and every later message in that thread goes to the same task ID. A pull request gets its route only when the task confirms it opened that PR. Messages from before a conversation's start timestamp are kept as context only.

```mermaid
stateDiagram-v2
  [*] --> pending: admit
  pending --> sending: drain claim, lease 60s
  sending --> done: Task admitted, fenced write
  sending --> pending: deferred behind start message, or failure with backoff 1s to 5 min
  sending --> context: older than the conversation start
  sending --> sending: lease expired, reclaimed with a new token and generation
  done --> [*]
  context --> [*]
```

## 7. Inside the Task object: the alarm pass

The Task object is a durable scheduler, not a request handler. Every entry point writes intent under the gate, arms an alarm, and returns. The alarm does the work in bounded batches. Network calls always happen between two gates: claim inside, call outside, record inside.

```mermaid
flowchart TB
  start(["alarm fires"]) --> adv["gate: re-arm now + 60s,<br/>advance(now): schedule, dispatch,<br/>resolve waits, settle"]
  adv --> modeCheck{"mode is not simulation?"}
  modeCheck -->|"yes"| prov
  modeCheck -->|"no"| deliv

  subgraph prov["Provisioning, up to 2"]
    p1["gate: Provisioning.claim"] --> p2["outside: Devbox.perform<br/>Namespace Create, Activate or Fetch"]
    p2 --> p3["gate: Provisioning.record, advance, recompute"]
  end

  prov --> opCheck{"mode is operator?"}
  opCheck -->|"yes"| steps
  opCheck -->|"no"| deliv

  subgraph steps["Operator steps, up to 4"]
    s1["gate: Steps.claim, lease 150s,<br/>build briefing"] --> s2["outside: Operator.run,<br/>one model round via Connection DO"]
    s2 --> s3["gate: Steps.record, dispatch,<br/>resolve waits, settle, recompute"]
  end

  steps --> ctl
  subgraph ctl["Control actions, up to 2"]
    c1["gate: Commands.claimControl, lease 60s"] --> c2["outside: GitHub createPullRequest"]
    c2 --> c3["gate: Commands.complete, advance, recompute"]
  end

  ctl --> deliv
  subgraph deliv["Deliveries, up to 16"]
    d1["gate: State.claimDueDelivery"] --> d2["outside: Platforms.forInstallation,<br/>resolveReply, react or reply"]
    d2 --> d3["gate: recordDeliveryOutcome, recompute"]
  end

  deliv --> fin["gate: recompute the next alarm<br/>or delete it when idle"]
```

Entry points that are not the alarm:

| Method               | Called by                  | Gate work                                                        | Outside the gate                                        |
| -------------------- | -------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------- |
| `admit`              | Inbox drain                | Record input on its origin or attached source, schedule the turn | None                                                    |
| `prepareEnvironment` | Inbox drain                | Capture environment and repository once                          | None                                                    |
| `attachConversation` | Ingress route              | Confirm a completed PR action for this exact source, attach it   | None                                                    |
| `runtimeAssignment`  | Box, Enrollment capability | Read the assigned resource and instance                          | None                                                    |
| `runtimeEnroll`      | Box, Enrollment capability | Replay check, then commit the epoch grant                        | Namespace Fetch to verify the instance, signing replies |
| `runtimeReady`       | Box, Readiness capability  | Accept readiness, advance                                        | Namespace Fetch                                         |
| `runtimePoll`        | Box, Readiness capability  | One command claim per second, up to `waitMs`                     | Mint a GitHub token, or fetch a Codex login for a round |
| `runtimeObserve`     | Box, Readiness capability  | Record the result under the epoch, advance                       | None                                                    |
| `snapshot`           | Binding RPC only           | Read everything except secrets                                   | None                                                    |

## 8. Operator turns, steps and the model broker

### Data model of a turn

```mermaid
flowchart LR
  source["task_sources<br/>origin Slack thread, or<br/>attached pull request"] --> input
  input["task_inputs<br/>one human message,<br/>obligation pending"] -->|"schedule, 1:1"| inv["execution_invocations<br/>one operator turn,<br/>operationId, resultId"]
  inv -->|"1:n ordered"| step["execution_steps<br/>index, operationId, status,<br/>parts, calls, attempts"]
  step -->|"1:n, one per tool call"| cmd["execution_commands<br/>spec, executor, status,<br/>claimEpoch, result"]
  inv -->|"settle, 1:1"| out["execution_outcomes<br/>final text or fallback"]
  out -->|"recordResponse"| resp["task_responses"]
  resp --> del["task_deliveries<br/>kind answer"]
  input --> react["task_deliveries<br/>kind reaction"]
```

### Step lifecycle

```mermaid
stateDiagram-v2
  [*] --> pending: Steps.ensure or the previous step finished
  pending --> running: claim, attempts+1, lease 150s
  running --> running: lease expired, re-offered to the next claimant
  running --> waiting: model returned tool calls
  running --> done: text without tool calls, final
  running --> pending: Retry on rate limit, network or 5xx, backoff up to 5 min
  running --> failed: auth or request error, or 6 attempts
  waiting --> done: every call resolved, tool results appended to parts
  done --> [*]: final, the turn settles
  done --> pending: not final, step index+1 opens, 200-step guard
  failed --> [*]: settles with an explanatory fallback answer
```

Each claim replays the whole turn: the briefing plus the encoded response parts of every earlier step, including tool results. The briefing holds the system prompt with task, dev box and repository state, the conversation history, and the current message. Every human message in the briefing is labeled with where it arrived, a Slack message or a GitHub pull request comment. The operator knows its answer to a PR comment is posted on GitHub. Nothing is stored on OpenAI's side: `store: false` is set, and encrypted reasoning travels inside the prompt.

### One model round through the broker

```mermaid
sequenceDiagram
  autonumber
  participant T as Task DO alarm
  participant Op as operator Operator.run
  participant LM as openai LanguageModel
  participant Br as api broker HttpClient
  participant C as Connection DO for initiatorId
  participant CS as accounts Connections
  participant O as OpenAI

  T->>T: gate: Steps.claim returns step, operationId, priorParts
  T->>Op: run(briefing, priorParts) with Broker.Operation userId and operationId
  Op->>LM: generateText, tools declared, disableToolCallResolution
  LM->>Br: POST /responses JSON body, no Authorization header
  Br->>C: forward(userId, operationId, method, url, body)
  C->>CS: gate: load row, check revoked
  alt forwards row exists for operationId
    CS-->>Br: replay the stored status and body, no provider call
  else
    CS->>CS: gate: refresh within 5 min of expiry, persist rotation first
    CS->>O: outside gate: exact URL allowlist, bearer and account header
    O-->>CS: status and body
    CS->>CS: gate: store definitive responses by operationId, 24h retention
    CS-->>Br: status and body
  end
  Br-->>LM: ordinary HTTP response, connection errors mapped to 401, 409, 502, 503
  LM-->>Op: content parts, text, unresolved tool calls
  Op-->>T: parts, text, calls, final
  T->>T: gate: Steps.record, dispatch, resolveWaits, settle
```

The same `operationId` is reused when a lost isolate re-runs a claimed step, so a completed provider call is not paid for twice.

## 9. Tool calls become durable work

The model never runs a tool inline; the toolkit handlers deliberately die. `dispatch` turns each call of a waiting step into durable state. `evaluate` reads that state on every pass until the call resolves.

```mermaid
flowchart TB
  wait["step status waiting<br/>calls: id, name, params"] --> which{"tool name"}

  which -->|"create_devbox"| cd["Provisioning.initialize<br/>binds to the operator attempt,<br/>or retryThrottled after a 429"]
  cd --> cdEval{"phase ready or blocked<br/>and no pending work?"}
  cdEval -->|"no"| pend["stay pending"]
  cdEval -->|"yes"| res["tool result appended"]

  which -->|"run_command"| rc["CommandSpec shell<br/>cwd under /workspaces, 120s"]
  which -->|"checkout_repository"| co["CommandSpec checkout<br/>path /workspaces/name, 300s"]
  which -->|"push_branch"| pb["CommandSpec push<br/>branch login/slug, never the default"]
  which -->|"run_specialist"| sp["CommandSpec specialist<br/>agent name, instructions, 45 min"]
  which -->|"create_pull_request"| pr["CommandSpec pull-request<br/>executor control; on success the task<br/>attaches the PR and takes its route"]
  which -->|"unknown"| bad["resolved immediately as a failure"]

  rc & co & pb & sp --> rt["execution_commands<br/>executor runtime, status pending"]
  rt --> stale{"box polled in the last 60s?"}
  stale -->|"no"| wake["Provisioning.requestWake<br/>probe-wake, then activate if stopped"]
  stale -->|"yes"| poll["claimed by the box on its next poll"]
  wake --> poll
  poll --> obs["observe: status done with result"]

  pr --> ctlq["execution_commands<br/>executor control"]
  ctlq --> alarm["Task alarm claimControl,<br/>GitHub createPullRequest,<br/>result records the PR Source"]
  alarm --> obs

  obs --> res
  rt -.->|"no result by timeout + 10 min"| failc["tool result is an error"]
  failc --> res
  bad --> res
  res --> allDone{"all calls resolved?"}
  allDone -->|"yes"| next["Steps.resolve: step done, next step pending"]
  allDone -->|"no"| pend
```

| Tool                  | Result the model reads                   | Notes                                                                                     |
| --------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| `create_devbox`       | phase, ready, resource, message          | A throttled Create blocks as `provider-throttled`; a later call re-arms the same creation |
| `run_command`         | exit code, truncated stdout and stderr   | No credentials in the environment                                                         |
| `checkout_repository` | path, branch, head SHA                   | Repeated calls report the existing checkout                                               |
| `run_specialist`      | report, or error with the agent's screen | Same agent name reuses the same Codex agent and its memory                                |
| `push_branch`         | branch, head SHA, `newCommit`            | `newCommit` is false when this branch already had that commit                             |
| `create_pull_request` | number, URL, branch                      | Opened by control, never on the box                                                       |

## 10. Dev box provisioning

A task gets at most one attempt and one box. The machine separates work that is claimed from work whose outcome is uncertain. An ambiguous Create or Activate is reconciled, never blindly repeated.

```mermaid
stateDiagram-v2
  state "pending-create" as pendingCreate
  state "ambiguous-create" as ambiguousCreate
  state "awaiting-readiness" as awaitingReadiness

  [*] --> pendingCreate: initialize with an environment
  [*] --> blocked: no environment
  pendingCreate --> creating: claim create
  creating --> created: Assigned, Namespace Create with activate false
  creating --> ambiguousCreate: Lost or claim expired
  creating --> blocked: Throttled, Namespace answered 429
  blocked --> pendingCreate: retryThrottled on a later create_devbox call
  ambiguousCreate --> blocked: reconcile-create is Unproven or NotFound
  created --> activating: claim activate
  activating --> awaitingReadiness: Activated with instanceId
  activating --> activating: Lost, reconcile-activation next
  activating --> blocked: reconciliation finds it Stopped or missing
  awaitingReadiness --> ready: runtime enrolled and readiness accepted
  ready --> ready: probe-wake finds it Running
  ready --> created: probe-wake finds it Stopped, activate again
  creating --> blocked: Rejected
  activating --> blocked: Rejected
  awaitingReadiness --> blocked: 10 min startup deadline, or unverified recovery
  ready --> blocked: ExternalExpire
  blocked --> [*]
```

`Devbox.perform` is the only place provisioning talks to Namespace. For `create` it issues the Enrollment capability and passes it with the control URL as box environment variables. The box session command is fixed as `exec /usr/local/bin/notus-devbox start`, and the image must be the approved, audited reference. Only a `provider-throttled` block with no resource can be re-armed, because nothing was created.

## 11. Dev box and Task object: enrollment, readiness, commands

The lowest-level connection in the system. The box never listens on a port. Every call is an HTTPS POST from the supervisor to the Worker's `/runtime/*` routes with a bearer capability.

### Capabilities

```mermaid
flowchart LR
  subgraph token["Wire format"]
    fmt["nr1.keyId.base64url(JSON capability).base64url(HMAC-SHA256)"]
  end
  subgraph enroll["Enrollment capability"]
    e1["audience: control URL"]
    e2["bootstrap: taskId, workspaceId, attemptId,<br/>generation, operationId, capabilityId"]
    e3["recoveryRevision: 0 at Create, then each grant's next revision"]
    e4["no expiry, valid only while its revision is current,<br/>exact replays return the same grant"]
  end
  subgraph ready["Readiness capability"]
    r1["audience, bootstrap"]
    r2["resourceId, instanceId, runId"]
    r3["epoch and challenge from the grant"]
    r4["expiresAt: 15 min, renewed by exact enroll replay"]
  end
  create["Namespace Create environment<br/>NOTUS_BOOTSTRAP_TOKEN"] --> enroll
  enroll -->|"allowed: /runtime/assignment, /runtime/enroll"| wroute["Worker callback.ts<br/>verify, then tasks.getByName(bootstrap.taskId)"]
  ready -->|"allowed: /runtime/ready, /runtime/poll, /runtime/observe"| wroute
```

The request body never selects a task: routing and authority come only from the verified capability. The Worker rejects a Readiness token on enrollment routes and an Enrollment token on runtime routes with 403.

### The full conversation

```mermaid
sequenceDiagram
  autonumber
  participant T as Task DO
  participant N as Namespace
  participant B as Supervisor on the box
  participant J as Journal, 0600 file
  participant H as Herdr server
  participant W as Worker /runtime

  rect rgb(235, 242, 255)
  Note over T,N: Provisioning, from the Task alarm
  T->>T: issue Enrollment capability, recoveryRevision 0
  T->>N: Create name notus-operationId, activate false, image, env CONTROL_URL and BOOTSTRAP_TOKEN
  N-->>T: resource id
  T->>N: Activate, waitForReadiness
  N-->>T: running, instanceId
  N->>B: start session notus-devbox start, cleared environment
  end

  rect rgb(240, 250, 240)
  Note over B,W: Enrollment, bound to this kernel boot
  B->>B: check linux x64 uid 1001, create boots/kernelBootId/owner atomically
  B->>J: write controlUrl and bootstrap credential
  B->>W: POST /runtime/assignment with Enrollment token
  W->>T: runtimeAssignment
  T-->>B: resourceId, instanceId, or 425 pending until activation is confirmed
  B->>J: pending request: resourceId, instanceId, requestId, runId, kernelBootId
  B->>W: POST /runtime/enroll
  W->>T: runtimeEnroll
  T->>T: gate: replay by requestId or revision
  T->>N: outside gate: Fetch, instanceId must match
  T->>T: gate: commit EpochGrant epoch, challenge, nextRecoveryRevision
  T-->>B: grant, recoveryCredential, readinessCredential, expiresAt
  B->>J: store the reply
  end

  rect rgb(255, 248, 235)
  Note over B,W: Readiness
  B->>H: spawn herdr server, clean environment, private socket
  B->>H: ping and session.snapshot until it answers, 15s budget
  B->>W: POST /runtime/ready observationId, protocol 22, herdrVersion
  W->>T: runtimeReady
  T->>N: outside gate: Fetch
  T->>T: gate: acceptReadiness, phase ready, create_devbox resolves
  T-->>B: acceptedAt
  B->>J: store the acknowledgement
  end

  rect rgb(248, 240, 255)
  Note over B,W: Command loop, for the life of the process
  loop forever
    alt within 3 min of readiness or of the last result
      B->>W: POST /runtime/poll waitMs 20000, held until a command or the deadline
    else idle
      B->>W: POST /runtime/poll waitMs 0, then sleep 5s doubling to 45s
    end
    W->>T: runtimePoll
    T->>T: gate: Commands.claim(epoch), fail commands held by older epochs
    opt checkout or push
      T->>T: outside gate: mint a scoped GitHub token, returned once, never stored
    end
    opt specialist
      T->>T: outside gate: agent login from agent:initiatorId, returned once
    end
    T-->>B: command id, spec, credential or null
    B->>B: busy hook start/end, bash as devbox, fixed env, timeout, 64 KiB cap
    B->>W: POST /runtime/observe commandId, result
    W->>T: runtimeObserve
    T->>T: gate: accept only if claimed under this epoch, advance
  end
  end
```

A held poll keeps the Task object busy, so an idle box stops long-polling. The idle cap of 45 seconds stays under control's 60-second staleness threshold, so a queued command reaches a running box without a provider wake. While a command runs, a marker file under `/.namespace/tasks` stops Namespace from stopping the box as idle.

### Recovery rules

- The journal is the box's only durable authority. It is written atomically (temp file, fsync, rename) and bound to the control URL.
- A pending enrollment from the same kernel boot ID means an unknown earlier process may still be running, so the supervisor refuses to start. After a reboot it first recovers the earlier reply by exact replay, then enrolls again with the next recovery credential.
- A re-enrollment after a new VM boot must prove the previous instance was destroyed through the Namespace instances API. Otherwise provisioning blocks with `recovery-unverified`.
- A poll from a newer epoch fails every command the old runtime had claimed (`runtime-restarted`), and nothing reruns automatically. A late observe from the old epoch is rejected with `conflict`.
- A Readiness token close to expiry is renewed by replaying the exact enrollment request. The same grant comes back with a fresh token, and the supervisor never invents an epoch.

### Command lifecycle

```mermaid
stateDiagram-v2
  [*] --> pending: dispatch enqueues, unique per step and call
  pending --> claimed: runtime poll under epoch E, or control lease
  claimed --> done: observe under epoch E, or control complete
  claimed --> failed: a newer epoch polled, runtime-restarted
  claimed --> claimed: control lease expired after 60s, reclaimed
  pending --> failed: run_command with no response by timeout + 10 min
  claimed --> failed: run_command with no response by timeout + 10 min
  claimed --> failed: GitHub token or agent login could not be obtained
  done --> done: identical replayed observe accepted, a different one is a conflict
  done --> [*]
  failed --> [*]
```

## 12. Specialist rounds

`run_specialist` hands one round of work to a named Codex agent running in a Herdr pane on the box. It is an ordinary runtime command with a 45-minute budget. Its credential is special: it's a login from the initiator's agent connection, not a GitHub token.

```mermaid
sequenceDiagram
  autonumber
  participant T as Task DO
  participant AC as Connection DO agent:initiatorId
  participant B as Supervisor
  participant Sh as Round shell
  participant H as Herdr
  participant X as Codex agent
  participant O as ChatGPT backend

  B->>T: poll claims specialist command
  T->>AC: agentLogin(agent:userId, 45 min + 10 min)
  AC->>AC: gate: refresh first if the access token would expire during the round
  AC-->>T: access token, ID token, account ID, expiresAt
  T-->>B: command plus a Codex auth.json with an empty refresh token
  B->>Sh: bash with NOTUS_AGENT_AUTH and NOTUS_INSTRUCTIONS in env, never in the script text
  Sh->>Sh: write ~/.codex/auth.json and config trusting the checkout, unset the variables
  alt no agent with this name yet
    Sh->>H: workspace create in the checkout, agent start --kind codex, approvals and sandbox bypassed
  end
  Sh->>H: agent prompt with the instructions and a report path, wait until idle or done
  H->>X: submit prompt
  X->>O: model calls with the round's login
  X->>X: edit files, run checks, write the Markdown report
  H-->>Sh: settled
  alt report file written
    Sh-->>B: report on stdout, exit 0
  else
    Sh-->>B: exit 7, the agent's recent screen on stderr
  end
  B->>T: observe result with specialist.report
  T->>T: tool result replays into the next model round
```

The instructions the agent reads are composed by control, not written whole by the operator: the workspace's role the call names (`# Role: implementer`: its summary, then its instructions), then the operator's instructions for the round (`# This round`). The role text comes from the roles the task captured when it started, so an edit on the dashboard's Specialists page reaches new tasks only. A role the workspace never defined fails the call with the list of roles, and no command is queued.

The agent can edit files but cannot publish; `push_branch` is still the only way code leaves the box. The box never receives a refresh token, the operator's model connection, or an API key.

## 13. Repository access and pull requests

One GitHub App, used through a bound installation. Every operation mints its own installation token, scoped to one repository with the least permissions it needs. No token ever combines Contents write with Pull requests write, which the merge endpoint requires, so no Notus credential can merge.

```mermaid
sequenceDiagram
  autonumber
  participant T as Task DO
  participant App as github App.forInstallation
  participant G as GitHub API
  participant B as Box supervisor
  participant Git as git process

  Note over T,Git: checkout_repository
  B->>T: poll claims checkout
  T->>App: readToken(repository)
  App->>G: POST /app/installations/id/access_tokens<br/>contents read, metadata read, one repository
  G-->>T: token, 1 hour
  T-->>B: command plus credential in the poll reply only
  B->>Git: git clone --branch main --depth 50, token in GIT_CONFIG env for this process
  B->>T: observe checkout path, branch, headSha

  Note over T,Git: push_branch slug
  B->>T: poll claims push
  T->>App: pushToken(repository), contents write, metadata read
  T-->>B: command plus credential
  B->>Git: checkout -B login/slug, add -A, commit as Notus bot if staged
  B->>Git: refuse if HEAD equals origin default, else push HEAD to refs/heads/login/slug
  B->>T: observe branch, headSha

  Note over T,G: create_pull_request, never on the box
  T->>T: alarm claimControl, lease 60s
  T->>App: createPullRequest(repository, branch, title, body)
  App->>G: token with pull_requests write, contents read, metadata read
  App->>G: POST /repos/owner/name/pulls head login/slug base main
  G-->>T: number, html_url
  T->>T: complete, result records the PR as a Source for later attachment
```

| Operation             | Runs where           | Token permissions                                 | Can it merge?                                        |
| --------------------- | -------------------- | ------------------------------------------------- | ---------------------------------------------------- |
| Checkout              | Box, one git process | Contents read, Metadata read                      | No                                                   |
| Push                  | Box, one git process | Contents write, Metadata read                     | No, and the refspec never targets the default branch |
| Open PR               | Task object          | Pull requests write, Contents read, Metadata read | No                                                   |
| Comment, reply, react | Task object delivery | Pull requests write, Contents read                | No                                                   |
| Collaborator role     | Api Worker ingress   | Metadata read                                     | No                                                   |
| `run_command`, Codex  | Box                  | None                                              | No; `git push` from bash cannot authenticate         |

## 14. Pull request feedback continues the task

A pull request comment never starts a task. It continues the task that owns the PR conversation: the task that opened it or, since 2026-09-16, the last task that checked it out by number. That task attached the conversation and wrote the inbox route itself when the action completed; the ingress only looks the route up.

```mermaid
sequenceDiagram
  autonumber
  actor R as Reviewer with write access
  participant G as GitHub
  participant W as Worker /github/events
  participant GA as GitHub adapter
  participant I as Inbox and D1
  participant T as Task DO that owns the route

  R->>G: review comment on PR 2
  G->>W: pull_request_review_comment, X-Hub-Signature-256
  W->>GA: receive: verify HMAC, decode issue_comment, review or review comment
  GA->>GA: ignore bots, apps and actions other than created or submitted
  GA-->>W: Received: startIntent false, root false, target review-comment id,<br/>text prefixed with file and line
  W->>I: workspaceOf(github installation), covers(owner/name)
  W->>GA: mayParticipate: collaborator role is admin, maintain or write
  W->>I: routeOf(conversation key): the task that opened or checked out the PR wrote it
  W->>I: admit input, then drain
  I->>T: admit: source must be attached, same initiator and workspace, never a start
  T->>T: new input with an answer obligation, eyes reaction, new operator turn
  Note over T: The briefing labels it as a GitHub pull request comment
  T->>G: eyes reaction on the comment
  T->>G: answer as a threaded reply, or a PR comment for top-level feedback
  G->>W: the bot's own reply arrives as a webhook
  W-->>G: 200, ignored as bot, no loop
```

Rules this enforces:

- The Slack origin thread remains the only update channel.
- Feedback never changes the task's owner or the model connection it uses.
- Nothing in a webhook payload can route feedback: only a task that opened or checked out the pull request writes its route.

Known limits:

- GitHub does not retry failed deliveries.
- A comment in the instant between opening the PR and recording the result is not attached.
- Comments from non-writers are dropped, not kept as review context.

## 15. Answers back to the platform: the delivery outbox

Every admitted human input creates an answer obligation and an eyes reaction delivery in the same transaction. A settled turn creates the response and its answer delivery together. The delivery resolves a handle through `Platforms.forInstallation(target.source)`, so the same outbox serves Slack threads and GitHub comments.

```mermaid
stateDiagram-v2
  [*] --> pending: admit creates the reaction, settle creates the answer
  pending --> sending: claimDueDelivery, claimId, generation, recoverAt 60s
  sending --> confirmed: platform accepted
  sending --> pending: RateLimited, retry at Retry-After
  sending --> rejected: pre-send rejection, unsupported target, or unknown installation
  sending --> ambiguous: answer timed out, unreadable response or claim expired, never resent
  sending --> pending: reaction ambiguous or claim expired, retried
  pending --> skipped: reaction after the answer was confirmed
  confirmed --> [*]: answer confirmed, input obligation fulfilled
  rejected --> [*]
  ambiguous --> [*]
  skipped --> [*]
```

An answer whose send may have succeeded is never retried automatically, so a conversation gets no duplicate replies. The obligation stays open instead of being reported as delivered. A GitHub review cannot carry a reaction, so its reaction delivery is rejected while its answer still goes out.

## 16. Dashboard: sign-in, workspaces and installs

The dashboard holds no data and no secrets. Every server function forwards the browser's cookie to an API RPC method. The API resolves the Better Auth session itself and authorizes against workspace membership and role.

```mermaid
sequenceDiagram
  autonumber
  actor A as Admin browser
  participant DW as Dashboard Worker
  participant W as Api Worker
  participant BA as Better Auth on the shared D1
  participant Id as accounts Identities
  participant WS as workspaces Workspaces
  participant P as Slack or GitHub

  rect rgb(235, 242, 255)
  Note over A,BA: Sign in with Slack or GitHub
  A->>DW: /auth/sign-in/...
  DW->>W: forward through the service binding
  W->>BA: OAuth or OpenID flow, session cookie on the dashboard origin
  end

  rect rgb(240, 250, 240)
  Note over A,WS: Any dashboard call
  A->>DW: page load or mutation
  DW->>W: RPC dashboardX(cookie, ...)
  W->>BA: getSession, listUserAccounts
  W->>Id: adopt: map the auth user to a canonical user,<br/>adopting an existing user that owns a verified identity
  W->>WS: authorize by membership and role, then act
  W-->>DW: ok with a projection, or a reason string
  end

  rect rgb(255, 248, 235)
  Note over A,P: Install a platform
  A->>DW: Install Slack or GitHub
  DW->>W: dashboardInstallUrl(cookie, workspace, platform)
  W->>WS: beginInstall: admin only, single-use nonce, 15 min
  W-->>A: platform URL with state = nonce
  A->>P: consent
  P->>W: GET /platforms/platform/install?state and code or installation_id
  W-->>A: 302 to the same path on the dashboard origin, for the session cookie
  A->>DW: GET /platforms/platform/install with the cookie
  DW->>W: dashboardCompleteInstall(cookie, platform, query)
  W->>WS: takeInstallIntent(nonce): only the user who began it completes it
  W->>P: adapter completes: Slack oauth.v2.access; GitHub App JWT lookup, then the installer's<br/>own user token must reach the installation with push on every repository it covers
  W->>WS: install: record installation and credential, refused if another workspace holds it
  W-->>A: 302 to the workspace Platforms page
  end
```

What a workspace controls from the dashboard:

| Area      | Stored in                                         | Who                           |
| --------- | ------------------------------------------------- | ----------------------------- |
| Workspace | `workspaces` name and slug                        | Admin                         |
| Members   | `workspace_memberships` with `admin` or `member`  | Admin                         |
| Invites   | `workspace_invites`, hashed token, 7 days         | Admin creates, anyone accepts |
| Platforms | `workspace_installations` with adapter credential | Admin                         |
| Scopes    | `workspace_scopes`, channels and repositories     | Admin, from the installation  |
| Sessions  | Better Auth sessions                              | The user                      |

## 17. Claims, leases and fences

The same pattern appears at every boundary where a network call meets durable state:

```mermaid
flowchart LR
  a["1. Claim inside a transaction or gate<br/>record owner token, generation or epoch,<br/>and a recoverAt deadline"] --> b["2. Do external work outside<br/>the gate, never inside<br/>a transaction"]
  b --> c["3. Record only if the stored claim<br/>still equals the one taken,<br/>otherwise a stale claim"]
  a -.->|"deadline passes"| d["Recovery: a later pass reclaims,<br/>or marks the work ambiguous<br/>when repeating is unsafe"]
  d --> a
```

| Claim             | Store                            | Fence                                                                 | Lease                   | On expiry                                                                      |
| ----------------- | -------------------------------- | --------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------ |
| Inbox message     | D1 `inbox_messages`              | `token` + `generation` + `state = sending`                            | 60s                     | Reclaimed with a new token                                                     |
| Route reservation | D1 `inbox_routes`                | Primary key on conversation, `INSERT ... ON CONFLICT DO NOTHING`      | None                    | First writer wins, everyone reloads                                            |
| PR attachment     | Task `task_sources` and D1 route | Done pull-request command with an equal `Source`; route task ID check | None                    | Unconfirmed claims are dropped; a route owned by another task is a conflict    |
| Install intent    | D1 `workspace_install_intents`   | Nonce primary key, taken once                                         | 15 min                  | Callback lands on `?install=expired-intent`                                    |
| Provisioning work | Task `execution_provisioning`    | Exact `Claim` value equality, `claimGeneration`                       | 30s                     | `create` becomes `reconcile-create`, `activate` becomes `reconcile-activation` |
| Operator step     | Task `execution_steps`           | `attempts` + `recoverAt`                                              | 150s                    | Same step and same `operationId` re-offered                                    |
| Runtime command   | Task `execution_commands`        | `claimEpoch` equals the caller's grant epoch                          | Until timeout + 10 min  | Failed; a newer epoch fails it at once                                         |
| Control action    | Task `execution_commands`        | `claimedAt`                                                           | 60s                     | Re-offered to the next alarm                                                   |
| Delivery          | Task `task_deliveries`           | `claimId` + `generation` + `recoverAt`                                | 60s                     | Reaction retried, answer marked ambiguous                                      |
| Model forward     | Connection `account_forwards`    | `operationId` primary key                                             | 24h replay window       | Identical response replayed                                                    |
| Enrollment        | Task `execution_enrollments`     | `(attemptId, revision)` and `(attemptId, requestId)` unique           | Grant token 15 min      | Exact replay returns the same grant                                            |
| Readiness         | Task `execution_readiness`       | `(attemptId, epoch)` and `observationId` unique                       | Startup deadline 10 min | Blocked with `startup-timeout`                                                 |
| Box process       | Box `boots/kernelBootId/owner`   | Atomic `mkdir`                                                        | Process lifetime        | Refused after a same-boot crash                                                |

## 18. Storage map

Shared D1 holds workspace-scoped control data, written through ordinary Worker-hosted services.

```mermaid
erDiagram
  WORKSPACES ||--o{ WORKSPACE_MEMBERSHIPS : "members"
  WORKSPACES ||--o{ WORKSPACE_INVITES : "invites"
  WORKSPACES ||--o{ WORKSPACE_INSTALLATIONS : "installed platforms"
  WORKSPACE_INSTALLATIONS ||--o{ WORKSPACE_SCOPES : "covered scopes"
  WORKSPACES ||--o{ WORKSPACE_INSTALL_INTENTS : "pending installs"
  WORKSPACES ||--o| WORKSPACE_ENVIRONMENTS : "dev box config"
  WORKSPACES ||--o{ WORKSPACE_ENVIRONMENT_REVISIONS : "every save"
  ACCOUNT_USERS ||--o{ WORKSPACE_MEMBERSHIPS : "belongs"
  ACCOUNT_USERS ||--o{ ACCOUNT_IDENTITIES : "verified identities"
  ACCOUNT_USERS ||--o{ ACCOUNT_LOGINS : "dashboard sign-ins"
  INBOX_ENVELOPES }o--|| INBOX_MESSAGES : "messageKey"
  INBOX_MESSAGES }o--o| INBOX_ROUTES : "conversationKey"

  WORKSPACES { string id PK string name string slug UK string createdBy }
  WORKSPACE_MEMBERSHIPS { string key PK string userId string role "admin or member" string provenance }
  WORKSPACE_INVITES { string id PK string tokenHash UK string role int expiresAt string acceptedBy int revokedAt }
  WORKSPACE_INSTALLATIONS { string key PK "platform, installationId" string workspaceId string label json credential "adapter-owned, never projected" }
  WORKSPACE_SCOPES { string key PK "workspace, platform, installation, scope" string scope string label }
  WORKSPACE_INSTALL_INTENTS { string nonce PK string userId string platform int expiresAt }
  WORKSPACE_ENVIRONMENTS { string workspaceId PK string provider json config "opaque" int revision }
  WORKSPACE_ENVIRONMENT_REVISIONS { string key PK "workspace, revision" string provider json config string authorId "null when the deployment wrote it" int createdAt }
  ACCOUNT_USERS { string id PK string name string email string image }
  ACCOUNT_IDENTITIES { string key PK "platform, installation, externalId" string userId FK string provenance "admin-fixture or oauth" }
  ACCOUNT_LOGINS { string authUserId PK "Better Auth user" string userId FK }
  INBOX_ENVELOPES { string key PK "per platform event" string payload }
  INBOX_MESSAGES { string key PK "per message" string state int generation int dueAt int recoverAt string initiatorId }
  INBOX_ROUTES { string key PK "per conversation" string taskId "origin or attached PR" string initiatorId string startMessageKey int initialized }
```

Better Auth's tables live in the same shared database under `@notus/db`'s schema and migrations: `auth_users` (with `slackTeamId` and `githubLogin`), `auth_sessions`, `auth_accounts` (provider tokens; the GitHub row is the dev box's git login) and `auth_verifications`. Better Auth reaches them through its D1 adapter with those model names and never migrates them itself. Until 2026-09-15 they were a second database, `AuthDb`; it was merged because one product wants one database.

Each Task object has its own SQLite database, and only that object reads it:

```mermaid
erDiagram
  TASKS ||--o{ TASK_SOURCES : "origin and attached"
  TASK_SOURCES ||--o{ TASK_INPUTS : "received on"
  TASK_INPUTS ||--o{ TASK_DELIVERIES : "reaction, answer"
  TASK_INPUTS ||--o{ TASK_RESPONSES : "answers"
  TASK_RESPONSES ||--o| TASK_DELIVERIES : "delivered by"
  EXECUTION_ATTEMPTS ||--o{ EXECUTION_INVOCATIONS : "turns"
  EXECUTION_INVOCATIONS ||--o{ EXECUTION_STEPS : "rounds"
  EXECUTION_INVOCATIONS ||--o| EXECUTION_OUTCOMES : "accepted"
  EXECUTION_STEPS ||--o{ EXECUTION_COMMANDS : "tool calls"
  EXECUTION_ATTEMPTS ||--o| EXECUTION_PROVISIONING : "dev box"
  EXECUTION_ATTEMPTS ||--o{ EXECUTION_ENROLLMENTS : "grants"
  EXECUTION_ATTEMPTS ||--o{ EXECUTION_READINESS : "receipts"
  EXECUTION_ATTEMPTS ||--o{ EXECUTION_WAKES : "wake requests"

  TASKS { int singleton PK string id json reservation string mode int closedAt }
  TASK_SOURCES { string id PK json attachment "origin, receive, reaction, reply, updates" }
  TASK_INPUTS { string id PK string messageKey UK string sourceId FK json input string obligation }
  TASK_RESPONSES { string id PK string resultId UK string text int final }
  TASK_DELIVERIES { string id PK string kind string status string claimId int generation int recoverAt }
  EXECUTION_ATTEMPTS { string id PK int generation string mode int active }
  EXECUTION_INVOCATIONS { string id PK string inputId UK string operationId UK string status }
  EXECUTION_STEPS { string id PK int index string operationId UK string status json parts json calls }
  EXECUTION_COMMANDS { string id PK string callId json spec string executor string status int claimEpoch json result "includes PR Source or specialist report" }
  EXECUTION_OUTCOMES { string id PK string invocationId UK json observation }
  EXECUTION_PROVISIONING { string attemptId PK string operationId UK string providerName UK json state }
  EXECUTION_ENROLLMENTS { string attemptId FK int revision string requestId json grant }
  EXECUTION_READINESS { string attemptId FK int epoch string observationId }
  EXECUTION_WAKES { string inputId PK string attemptId FK }
```

The Task object also holds singleton tables:

- `execution_environment` and `execution_repository`, captured once at admission so later configuration edits never change active work.
- `execution_polls`, the epoch and time of the last runtime poll.

Each Connection object holds:

- `account_connections`: one row with the provider, access, refresh and ID tokens, expiry, seed fingerprint and revocation.
- `account_forwards`: replayable responses by operation ID.

## 19. Not built yet

Planned in the slice plans but not built at `4cd36b9`:

- **Platforms:**
  - the shared adapter conformance suite
  - application-level encryption of stored installation credentials and connections
- **Task host:** it still mints repository tokens and opens pull requests through the deployment's configured GitHub installation, for the repository in `NOTUS_FIXTURE_REPOSITORY`, not through the workspace's own installation and scopes.
- **Dashboard:**
  - connecting model accounts: ChatGPT device code, API key, per-workspace operator backend
  - specialist role and per-repository instructions
- **PR feedback:**
  - comments from non-writers are not yet kept as review context
  - GitHub does not retry deliveries lost during an outage
- **Operator:**
  - plan approval through Plannotator
  - named reviewer roles
  - cancellation and closure
  - the 90-day retention sweep

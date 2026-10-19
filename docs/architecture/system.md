# System design

The built system at a glance: its primitives, who talks to whom, the code tiers, and where each credential lives. [Architecture rules](CONTEXT.md) own the conventions.

## Primitives

| Primitive          | What it is                                                                                                                           | Where it lives                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| Stage              | One deployment: a developer's own (`$USER`) or `production`, each with its own Workers, databases, objects and `notus.run` hostnames | Alchemy stack                                           |
| Workspace          | A team's configuration and access boundary: members with roles, installations, scopes, dev box environment                           | Shared D1                                               |
| Platform           | A system humans talk through: `slack` or `github`. One adapter per platform implements the `@notus/platform` contract                | Code: `@notus/platform-slack`, `@notus/platform-github` |
| Installation       | A platform connected to one workspace: a Slack team with its bot token, a GitHub App installation                                    | D1 `workspace_installations`                            |
| Scope              | A place the workspace covers inside an installation: a channel, a repository                                                         | D1 `workspace_scopes`                                   |
| Source             | A conversation address: `platform, installationId, scope, conversation` (a thread, a pull request number)                            | Inputs, routes, task sources                            |
| Input              | One verified, platform-neutral message with an actor, reply target, start intent and `root` flag                                     | D1 inbox, then the Task object                          |
| Route              | Binds one conversation to one task ID and its initiator. A task owns its origin thread and any attached pull request                 | D1 `inbox_routes`                                       |
| Task               | The authoritative record of one piece of work: origin and attached sources, inputs, answer obligations, responses                    | One Task Durable Object per task ID                     |
| Attempt            | One assignment of the task to an execution mode (`simulation`, `readiness`, `operator`); one active per task                         | Task object                                             |
| Invocation         | One operator turn, created for exactly one admitted human input                                                                      | Task object                                             |
| Step               | One persisted model round inside a turn; may end in text or in unresolved tool calls                                                 | Task object                                             |
| Command            | Durable work a tool call needs: `shell`, `checkout`, `push`, `specialist` run on the box; `pull-request` runs in control             | Task object                                             |
| Provisioning state | The dev box's lifecycle: phase, provider resource, runtime epoch, readiness                                                          | Task object                                             |
| Capability         | An HMAC-signed bearer token (`nr1.`) naming the task binding it authorizes: Enrollment or Readiness                                  | Issued by the Task object's host, held by the box       |
| Delivery           | An outbox row for one reaction or answer, sent through the platform registry, with its own claim and outcome                         | Task object                                             |
| Connection         | One saved model login. `userId` serves the operator; `agent:userId` serves Codex on the box                                          | One Connection Durable Object per name                  |
| Canonical user     | The Notus user a Slack mention or dashboard sign-in resolves to; Better Auth users map onto it through `account_logins`              | Shared D1, plus Better Auth tables in `AuthDb`          |
| Operation ID       | The idempotency key of an external effect: a model forward, a provisioning create                                                    | Step, provisioning state                                |
| Gate               | `blockConcurrencyWhile`: short, local, synchronous-SQLite critical sections. Network work never runs inside it                       | Task and Connection objects                             |
| Claim / lease      | Take work under a gate with an expiry, do it outside, record it only if the claim still matches                                      | Everywhere                                              |

## System context

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
    worker["Api Worker<br/>events, auth, installs,<br/>runtime, cron, dashboard RPC"]
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
  dash -->|"service binding: /auth/* and /rpc"| worker
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

## Code tiers

Imports only point downward or sideways. Arrows are the main `@notus/*` imports in `src/`.

```mermaid
flowchart TB
  root["alchemy.run.ts<br/>Api and Dashboard resources"]
  subgraph t4["Tier 4 apps: startup, bindings, configuration"]
    api["apps/api<br/>Worker and DO declarations, Better Auth,<br/>platform adapters for the ports"]
    dashboard["apps/dashboard<br/>TanStack Start, shadcn, TanStack DB"]
    devbox["apps/devbox<br/>Bun supervisor, Docker image"]
  end
  subgraph t3["Tier 3 entrypoints: cross-domain use cases"]
    control["@notus/control<br/>Api routes, dashboard RPC, objects (Task,<br/>Connection, Build), inbox, use cases, ingress,<br/>broker, runtime auth, protocol, server, client"]
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
    cns["@notus/compute-namespace<br/>adapter"]
    cboat["@notus/compute-boat<br/>adapter"]
  end
  subgraph t1["Tier 1 packages: vocabulary and provider SDKs"]
    platform["platform<br/>contract, ids, descriptors"]
    contracts["contracts<br/>json"]
    shared["shared<br/>stages, hostnames"]
    compute["compute<br/>devbox provider contract"]
    db["db<br/>schemas, relations, migrations,<br/>Shared, Task and Connection stores"]
    cloudflare["cloudflare<br/>sealing"]
    slackp["slack"]
    githubp["github"]
    namespacep["namespace"]
    boatp["boat"]
    openaip["openai"]
    herdrp["herdr"]
  end

  root --> api
  root --> shared
  api --> control & db & cloudflare & shared & compute
  dashboard -.->|"type only"| api
  devbox --> control & executions & herdrp
  control --> operator & tasks & executions & accounts & workspaces & platforms
  control --> platform & cloudflare & db & pslack & pgithub & githubp & openaip
  tasks --> executions
  executions --> workspaces & compute & contracts
  accounts --> openaip
  workspaces --> contracts
  platforms --> platform
  pslack --> platform & slackp
  pgithub --> platform & githubp
  cns --> compute & namespacep
  cboat --> compute & boatp
  tasks & executions & accounts & workspaces --> platform
  tasks & executions & accounts & workspaces --> db
  namespacep --> contracts
```

`@notus/platform` depends on `effect` only, so descriptors can be imported anywhere. `@notus/slack` and `@notus/github` know nothing about Notus. Only the two adapter domains import them for sources, and entrypoints only see `@notus/platforms`. The dashboard imports the RPC contract, `@notus/control/dashboard/rpcs`, which holds schemas only.

## Hosts, responsibilities and secrets

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
    w5["/rpc Effect RPC for the dashboard: every call resolves the session itself"]
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

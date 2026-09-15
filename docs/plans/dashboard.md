# Dashboard plan

The dashboard is where a team configures Notus: who belongs to a workspace, which Slack channels and GitHub repositories it covers, which model accounts its members use, and what instructions its agents follow. Today all of that is deployment configuration and administrator-seeded fixture rows. This plan replaces the fixture path with real accounts, workspaces and settings while keeping every boundary the [product context](../../CONTEXT.md#login-and-authority) requires: verified identities, user-owned model connections, and no credential ever returned to a browser.

Decisions taken with the user on 2026-09-14: a TanStack Start app on its own Worker, built with shadcn/ui on Base UI and TanStack DB for optimistic client state; Better Auth for sign-in, through Alchemy's `@alchemy.run/better-auth` package; sign-in with Slack and with GitHub; multiple workspaces with invites from the start; instructions as specialist roles plus per-repository overrides.

## Shape

- **`apps/dashboard`** is a TanStack Start application deployed by Alchemy as its own Worker through `Cloudflare.Website.Vite`. The UI is shadcn/ui components on Base UI primitives. Client state lives in TanStack DB collections backed by TanStack Query, so edits to members, repositories or instructions apply optimistically and reconcile with the server's answer; the framework skills come from TanStack Intent, installed in the dashboard package so an agent working there loads the current docs for Start, Router, Query and DB rather than guessing.
- **Better Auth runs on the API Worker.** `yield* BetterAuth({...})` with the `CloudflareD1` layer over a dedicated `AuthDb` database, which keeps Better Auth's auto-migrated schema apart from the Drizzle-managed shared database. The API serves the `/auth/*` routes; the dashboard Worker forwards `/auth/*` to the API through its service binding so the session cookie belongs to the dashboard's origin. Alchemy provisions the signing secret.
- **The API Worker stays the only owner of data, and validates every session itself.** Dashboard server functions call the API through the service binding and Worker RPC, passing the request's cookie header; the API resolves the session with `auth.getSession()` and authorizes the call against workspace membership and role. Nothing the dashboard sends is trusted as identity, and no dashboard route exposes D1, Durable Objects or provider tokens.
- **`entrypoints/control`** gains the cross-domain use cases the [codebase plan](codebase.md#control) already assigns to it: account linking, workspace administration, connection setup and instruction editing. Domains keep the tables; control composes them; the API Worker exposes them as RPC methods.
- **Sessions** are Better Auth sessions: `Secure; HttpOnly; SameSite=Lax` cookies, listed and revocable from the account page. Server functions check the `Origin` header on mutations.

## Identity and sign-in

- **Sign in with Slack** is Better Auth's Slack social provider, Slack's OpenID Connect flow with the `openid`, `profile` and `email` scopes. The verified subject is the Slack user ID; the team ID comes from the ID token's team claim and is stored with the account, because the Slack source adapter resolves initiators by team and user. Signing in _is_ the identity link the product requires.
- **Sign in with GitHub** is Better Auth's GitHub provider using the dedicated GitHub App's OAuth client. The verified subject is the GitHub user ID and login, the same identity PR feedback authorization already relies on through repository collaborator roles.
- Either provider can create or open a user. The other provider is linked from the account page with Better Auth's account linking, which refuses an identity already owned by another user. OAuth state handling is Better Auth's.
- **Better Auth's user is the canonical Notus user.** Its `user` and `account` tables become the source of truth for identities; `account_identities` keeps the fixture rows for the dev stage and is otherwise read from the auth database when a Slack mention or a GitHub comment needs an initiator. A Slack-started task resolves its initiator exactly as today; sign-in only changes where the identity rows come from. The dev stage keeps fixture seeding so a fresh deployment works before anyone signs in.

## Workspaces, membership and invites

- `workspaces` (ID, name, slug, created by, created at) replaces the implicit fixture workspace. `workspace_memberships` gains a `role` of `admin` or `member` and keeps `provenance`. The creator of a workspace is its first admin.
- `workspace_invites` hold a hashed token, the workspace, the role offered, who invited, an expiry and who accepted. An invite is a link the admin copies out of the dashboard; accepting it while signed in creates the membership. Invites can be revoked and expire after seven days.
- Admins manage members, roles, channels, repositories, environments and instructions. Members manage only their own connections and identities. `authorizeStart` keeps its current meaning, membership in the workspace that owns the channel, and gains nothing from roles; cancel and reopen remain initiator or admin.
- **Slack channels.** For the first increments the Slack app stays installed at deployment level, and an admin selects which channels of that team the workspace listens to; `workspace_channels` rows come from the dashboard instead of the fixture. Per-workspace Slack installation, with a bot token per team encrypted at rest, is a later increment once a second team exists.
- **GitHub repositories.** An admin installs the GitHub App on their organization from the dashboard through GitHub's installation flow with a `state` bound to the workspace; the `installation` webhook and the callback record `workspace_github_installations` (installation ID, account login). The repositories that installation grants are listed from GitHub and the admin enables the ones tasks may target, which fills `workspace_repositories` (full name, default branch, enabled). The task's repository is then chosen from that list instead of `NOTUS_FIXTURE_REPOSITORY`; the first version still targets one repository per task, so a workspace with several enabled repositories needs the initiator to name one in the request, and the operator asks when it cannot tell.

## Model connections

- Each member connects their own model account from the account page. Status shows provider, account, rotation time and revocation; the page never shows a token. Disconnect revokes the row in the user's Connection object.
- **ChatGPT subscription.** Codex's device-code login works from a hosted page: the API Worker asks the Codex public client for a user code, the page shows the code and the verification link, and the Worker polls for the token until the user completes it or fifteen minutes pass. The endpoints and their exact base URL are recorded from the pinned Codex source before implementation; if the client is refused for device code, the fallback is the existing local `bun run login:chatgpt` with an upload of the resulting file through the dashboard, which is still a user action on their own account.
- **Platform API key.** Pasted once, stored in the Connection object, fingerprinted for status, never displayed again.
- One saved ChatGPT connection serves both the operator, when the workspace selects the subscription backend, and Codex on the dev box. The separate `agent:<user>` object introduced for the fixture becomes an internal detail: the agent login is served from the user's connection with the same minimum-lifetime refresh. A workspace policy setting chooses the operator backend (`openai-chatgpt` or `openai-api`) per workspace rather than per deployment.
- **Encryption at rest.** Connection rows and any per-workspace provider token are encrypted with a deployment-held key before they reach storage; the object decrypts only inside its gate. This lands with the connection increment because it is the first time tokens enter through a browser.

## Instructions

- **Specialist roles.** `workspace_roles` hold named Markdown instructions (`implementer`, `reviewer`, `qa` by default, editable and extendable) with a revision per save and the author recorded. `run_specialist` gains a `role` parameter; the role's Markdown is prepended to the operator's round instructions, and the operator's prompt lists the roles available with their first line.
- **Per-repository overrides.** `workspace_repository_instructions` hold Markdown per enabled repository, layered after the role text for every round in that repository: conventions, how to run checks, what never to touch.
- **Recorded at task creation.** When a task starts, control snapshots the resolved roles and the repository override into the task, the same way the repository and environment are captured today, so editing instructions never changes work already in flight. The dashboard shows which revision each open task uses.
- Operator-level workspace instructions were left out of the first version by decision; the schema leaves room for them as a role named `operator` if that changes.

## Environments

- The environment editor exposes the workspace's Namespace configuration as the opaque JSON the provider package validates, with the revision history the `workspace_environments` table already keeps and a diff between revisions. The approved image reference stays a deployment gate; the editor can only select images the deployment approves.
- The Namespace control token stays a deployment secret for now. A per-workspace token, encrypted like connections, is a later increment.

## Client conventions

- **No effects.** `useEffect` and `useLayoutEffect` are lint errors in `apps/dashboard`. Values derive from props, loader data and stores during render; a side effect that runs because state changed is a bug in waiting. Anything that is genuinely an external source (a TanStack DB collection, a media query) is read with `useSyncExternalStore`, and server data lives in TanStack Query or a collection rather than in component state, so it survives navigation.
- **Shortcuts** go through `@tanstack/react-hotkeys` (`useHotkey("Mod+B", …)`), never hand-rolled `keydown` listeners, so bindings are declared once, cross-platform, and visible to devtools.

## Data changes

New tables in shared D1: `workspaces`, `workspace_invites`, `workspace_github_installations`, `workspace_repositories`, `workspace_roles`, `workspace_repository_instructions`, `workspace_policies`. Changed: `workspace_memberships` gains `role`. Better Auth owns `user`, `session`, `account` and `verification` in the dedicated `AuthDb`, migrated by Alchemy at deploy. The Task object records resolved instructions beside the captured repository. Drizzle migrations are generated, never hand-edited, and each increment ships its own.

## Boundaries that do not move

- No browser ever receives a provider token, a session for someone else, or a fixture secret. RPC methods return status projections only, like `connectionStatus` does today.
- Sign-in proves an identity; it grants no workspace access by itself. Access comes from membership, and credential use from the member's own connection under workspace policy.
- Notus still cannot merge, deploy to production or approve its own plans. Nothing in the dashboard changes execution authority.
- The GitHub App private key, Slack signing secret and Namespace token remain deployment secrets on the API Worker.

## Increments

1. **App and sign-in.** `apps/dashboard` in Alchemy with shadcn/ui, TanStack DB and Intent skills; Better Auth on the API with `AuthDb`; Slack and GitHub sign-in; the `/auth` forward; account page with identity linking and session list. Ships with a read-only view of the workspaces the user belongs to.
2. **Workspaces.** Create, members and roles, invites, channel selection; fixture seeding reduced to the dev stage, then removed with the [platforms plan](platforms.md).
3. **Connections.** ChatGPT device-code login, API key, status and revoke, unified agent login, encryption at rest, per-workspace operator backend.
4. **Repositories.** GitHub App installation flow, repository enablement, task repository selection from the workspace list. The installation flow and the channel page move to the [platforms plan](platforms.md), which replaces both with installations and scopes over a registered adapter contract.
5. **Instructions.** Roles, per-repository overrides, the `role` parameter on `run_specialist`, resolved instructions recorded per task and shown per task.
6. **Environments.** The revisioned editor over the existing environment table.

## Status

- **Increment one shipped on 2026-09-14.** `apps/dashboard` on its own Worker at `<stage>.notus.run`; Better Auth on the API over `AuthDb`; Slack and GitHub sign-in verified live, including account linking with differing emails. GitHub Apps ignore the email scope, so users without an email permission get GitHub's no-reply address until the App's Email addresses permission is granted.
- **Increment two shipped the same day.** Workspaces, admin and member roles, hashed week-long invites, and Slack channel selection from the installed team. Sign-ins adopt an existing canonical user through `account_logins` when one of their verified identities already belongs to it, which keeps the fixture user's connections and tasks; the fixture seed now also creates the workspace row and makes the fixture member an admin. Channels and invites on the workspace page are TanStack DB query collections with optimistic insert, delete and revoke; the page disables SSR as TanStack DB requires.
- Not yet: the offline harness does not cover the dashboard Worker; per-workspace Slack installation; the remaining increments.

## Validation

Each increment extends the offline harness: the dashboard Worker runs in the same Miniflare setup with a service binding to the API Worker, Better Auth on its `Memory` or `SQLite` layer, and fake Slack, GitHub and OpenAI endpoints; the checks cover sign-in callbacks, session validation on the API side, session revocation, invite acceptance and expiry, role authorization on every RPC, connection status without secrets, device-code completion and timeout, instruction snapshots surviving later edits, and zero unexpected outbound requests. Live verification happens on the developer stage before production exists. Repository tests stay out unless requested.

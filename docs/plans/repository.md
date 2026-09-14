# Repository access

Authorized follow-up to the [operator plan](operator.md). The user chose the private repository `<owner>/<repo>` as the first target and a dedicated GitHub App as the authority. This document records the implemented increment and its gates; [product context](../../CONTEXT.md) owns behavior and the [codebase plan](codebase.md) owns ownership.

## Scope

The operator can check the task's repository out on its dev box, run commands inside it, push its changes to a branch under the initiator's GitHub login, and open a pull request into the default branch. The App now holds Contents write and Pull requests write, but no single Notus token ever does: each operation mints its own token with the least permission it needs. PR feedback as a task source is the next increment.

## Tools and control

- `push_branch { slug, message }`: the supervisor commits the whole checkout as `Notus <notus[bot]@users.noreply.github.com>` and pushes `HEAD` to `<initiator login>/<slug>`. The login is captured with the repository at admission, for the fixture user from `NOTUS_FIXTURE_GITHUB_LOGIN`; control validates the slug, derives the branch, and refuses the default branch, and the executor pushes an explicit refspec to that branch only. The Contents-write token exists in that one git process's environment. An empty diff is refused rather than committed.
- `create_pull_request { slug, title, body }`: runs in the control plane as a leased action from the Task alarm, never on the box, with a Pull-requests-write token that has no Contents write. Returns number and URL.
- `run_command` still runs without credentials, so `git push` from bash always fails; bash on the box cannot authenticate to GitHub at all.
- No merge exists anywhere: there is no merge tool, the merge endpoint requires Contents write and Pull requests write on one token and Notus never mints both together, and the push refspec can never target the default branch. This repository cannot carry branch protection on its current plan, so these application rules stand alone; a human with write access merges through GitHub.

## Ownership

- `@notus/github` (tier 1): App JWT signing with WebCrypto from a PKCS#8 key, and one operation: a repository-scoped installation token with read-only permissions. Failures carry status and classification only.
- `executions`: the repository captured once per task at admission, a `checkout` command kind beside `shell`, a working-directory allowlist of `/workspaces` or one checkout under it, and the checkout result on the command observation.
- `entrypoints/operator`: the `checkout_repository` tool, a `cwd` parameter on `run_command`, and the repository line in the prompt including the checkout path once one exists.
- `control/operator`: dispatch and evaluation for checkout calls, including immediate failures when no box, no repository or no App exists.
- `apps/api`: `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY` and `NOTUS_FIXTURE_REPOSITORY` configuration. The Task object mints the token only when the enrolled supervisor claims a checkout command, outside its gate, and returns it once in that poll reply. Without an App the claimed command fails closed and the runtime receives nothing.
- `apps/devbox`: the checkout executor runs `git clone` of the default branch, shallow and single-branch, and the push executor commits and pushes to the task branch; both receive their token through git's environment configuration for that process only. It never appears on a command line, in `.git/config`, or in the supervisor's own environment. A repeated checkout reports the existing checkout.

## Limits

Repository commands run as the same OS user as the supervisor. A hostile build script could read the runtime's callback journal, whose credential grants only this attempt's runtime authority, or the git objects of the checkout. This is a documented limit for the disposable test scope, not isolation. The [codebase plan](codebase.md#runtime-and-data-ownership) keeps enforced isolation as a gate before any untrusted repository.

Later fetches need a fresh token; only the initial clone is covered. Tokens expire after one hour and are not cached.

## Validation

Harness: 111 checks across both model providers, including the App JWT and read-only scope of the token request, the credential appearing only in the poll reply and never in the task snapshot, the checkout result replayed into the next model round, the prompt reporting the checkout path, a command in the checkout directory, and the fail-closed path without an App. The readiness and simulation harness was rerun. The clone executor ran inside the version 3 image against a local repository: first clone, idempotent repeat, no token in git configuration, and a missing branch failing with exit 128. The App files were verified by minting one scoped token from the workstation. Image version 3 was published and audited, the workspace environment moved to revision 3, and the test stage was deployed with the App secrets. Live: a new task created devbox `l879m39ao36u2`, checked out `<owner>/<repo>` at `main` and answered with HEAD `0fb4c3afbc52c5b8d2bf25c87dc1a4475644bb4a`, which matched the repository's current `main` on GitHub at that moment; the [intake results](../research/intake-results.md#current-status) record it.

Idle supervisors keep long-polling every twenty seconds; backing off while idle is a small follow-up.

A live lesson: the first push attempt stranded a box. The branch naming policy had changed to `<initiator login>/<slug>` after image version 4 was published, and the shared wire schema on that box still rejected anything outside `notus/`, so decoding the poll reply failed permanently and the supervisor exited with the command left claimed. The wire schema now accepts any safe git ref and the naming policy lives only where control builds the command, published as image version 5 with environment revision 5. Boxes on older images cannot be upgraded in place; the stranded task's push fails by deadline with an explanation, and new tasks use the new image.

The push and pull-request increment was validated offline the same way: 121 harness checks across both providers cover the push command with a Contents-write token that carries no Pull requests write, the pull request opened by control with a Pull-requests-write token that carries no Contents write, both results replayed into the next round, and the pull request never becoming a runtime command; the push executor ran inside the version 4 image against a local bare repository, refusing an empty diff, landing a bot-authored commit on a task branch while `main` stayed untouched, and rejecting a pull-request command on the box. Image version 4 was published and audited, the workspace environment moved to revision 4, and the App's installation grants were verified by minting a write-scoped token. The App is installed on all repositories of the account; Notus only ever scopes tokens to the configured one.

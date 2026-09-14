# Repository access

Authorized follow-up to the [operator plan](operator.md). The user chose the private repository `<owner>/<repo>` as the first target and a dedicated GitHub App as the authority. This document records the implemented increment and its gates; [product context](../../CONTEXT.md) owns behavior and the [codebase plan](codebase.md) owns ownership.

## Scope

The operator can check the task's repository out on its dev box and run commands inside it. Everything is read-only: the App has Contents read and Metadata read, tokens are minted with exactly those permissions for one repository, and nothing in this increment can push, open pull requests, or touch GitHub beyond cloning. Pull requests, pushes and PR feedback are the next increment.

## Ownership

- `@notus/github` (tier 1): App JWT signing with WebCrypto from a PKCS#8 key, and one operation: a repository-scoped installation token with read-only permissions. Failures carry status and classification only.
- `executions`: the repository captured once per task at admission, a `checkout` command kind beside `shell`, a working-directory allowlist of `/workspaces` or one checkout under it, and the checkout result on the command observation.
- `entrypoints/operator`: the `checkout_repository` tool, a `cwd` parameter on `run_command`, and the repository line in the prompt including the checkout path once one exists.
- `control/operator`: dispatch and evaluation for checkout calls, including immediate failures when no box, no repository or no App exists.
- `apps/api`: `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY` and `NOTUS_FIXTURE_REPOSITORY` configuration. The Task object mints the token only when the enrolled supervisor claims a checkout command, outside its gate, and returns it once in that poll reply. Without an App the claimed command fails closed and the runtime receives nothing.
- `apps/devbox`: the checkout executor runs `git clone` of the default branch, shallow and single-branch, with the token supplied through git's environment configuration for that process only. It never appears on a command line, in `.git/config`, or in the supervisor's own environment. A repeated call reports the existing checkout.

## Limits

Repository commands run as the same OS user as the supervisor. A hostile build script could read the runtime's callback journal, whose credential grants only this attempt's runtime authority, or the git objects of the checkout. This is a documented limit for the disposable test scope, not isolation. The [codebase plan](codebase.md#runtime-and-data-ownership) keeps enforced isolation as a gate before any untrusted repository.

Later fetches need a fresh token; only the initial clone is covered. Tokens expire after one hour and are not cached.

## Validation

Harness: 111 checks across both model providers, including the App JWT and read-only scope of the token request, the credential appearing only in the poll reply and never in the task snapshot, the checkout result replayed into the next model round, the prompt reporting the checkout path, a command in the checkout directory, and the fail-closed path without an App. The readiness and simulation harness was rerun. The clone executor ran inside the version 3 image against a local repository: first clone, idempotent repeat, no token in git configuration, and a missing branch failing with exit 128. The App files were verified by minting one scoped token from the workstation. Image version 3 was published and audited, the workspace environment moved to revision 3, and the test stage was deployed with the App secrets. Live: a new task created devbox `l879m39ao36u2`, checked out `<owner>/<repo>` at `main` and answered with HEAD `0fb4c3afbc52c5b8d2bf25c87dc1a4475644bb4a`, which matched the repository's current `main` on GitHub at that moment; the [intake results](../research/intake-results.md#current-status) record it.

Idle supervisors keep long-polling every twenty seconds; backing off while idle is a small follow-up.

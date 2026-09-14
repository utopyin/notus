# Devbox slice results

Validation on 2026-09-13 for the authorized [devbox slice](../plans/devbox.md).

**Initial Namespace startup now passes.** A controlled image-user change fixed the reproduced container-creation failure. The final source image passed automatic Herdr readiness with an explicit native Create session. Stop/start readiness and production provisioning remain incomplete; no model ran.

## Follow-up startup investigation

The user authorized rebuilding the current runtime and retrying isolated startup after the diagnostic-cleanup branch. Evidence is in `/tmp/notus-startup-C7HY46/REPORT.md`, with intent records, receipts, image hashes, remote checks and cleanup observations. The original failed slice remains recorded below.

### Reproduction and fix

The fresh numeric-user baseline reproduced `NotCreatedWithinDeadline`. Its VM booted in about 5.88 seconds, but the container failed after about five minutes. Updating the runtime code alone did not fix startup.

A diagnostic image derived from that exact digest changed only Docker `USER 1001:1001` to `USER devbox`. Activation then succeeded in about eight seconds. A separately rebuilt final-source image also activated in about eight seconds. Both still ran as UID/GID 1001 with no privilege increase. The fix is in both `apps/devbox/Dockerfile` and `Dockerfile.derived`.

Namespace derived `dockerSockUser.user` as literal `1001:1001` for the failing image and `devbox` for the successful image. This supports a compatibility problem with the numeric UID:GID form. The backend's exact failing lookup is not visible; Docker setup itself cannot be blamed because it remained enabled in successful runs. Retained failure logs contained only kernel records, not the container-runtime error.

### Startup metadata and authority

Both CLI registration and two native `WireImage` probes returned Docker-client setup enabled and dropped the canonical startup session. The native probes supplied explicit false and session metadata, returned HTTP 200, and produced new image versions, but readback still differed. This is not solely a CLI discrepancy, and no effective Docker-on/off comparison was possible.

Supplying this native Create field worked and survived Create/Fetch/Activate:

```json
{ "sessions": [{ "name": "notus", "command": "exec /usr/local/bin/notus-devbox start" }] }
```

The private probe inserted that trusted session directly. This does not validate production provisioning through `Namespace.Service.create`: its user-configuration codec still rejects the reserved `notus` session, and that service does not yet add trusted startup settings. Keep this authority boundary explicit rather than removing the guard or silently permitting arbitrary bootstrap replacement. Slack provisioning remains unwired.

The final automatic session passed native Herdr 0.9.0/protocol 22 ping and snapshot, reported `taskAuthorized: false`, and had exactly one Herdr server process. UID/GID were 1001; a harmless environment setting arrived; the runtime bundle hash matched `61cc7866f050c9dfe56771c390c263bbeba92dcac2fd304b9d196d3701ec3d0c`.

Herdr's environment contained exactly its 12 intended keys and no inherited credential keys. Namespace nevertheless installed registry credentials in the devbox home as part of Docker setup. Environment filtering is not filesystem isolation, and the box must not be described as credential-free. Namespace created an empty `/.namespace/tasks` directory; zero task entries were present. An initial temporary assertion mistook directory existence for a task marker; the corrected assertion and original failure are retained.

### Stop/start limitation

Native Stop and Activate succeeded on the diagnostic box, with a new backing instance after restart. Herdr readiness failed and `owner/` remained. The probe did not delete state to force recovery. That box had used an explicitly started supervisor because registration lost its session; automatic session restart after stop was not separately validated on the final box. No sleep/resume or task-restoration claim follows from successful initial startup. Auto-sleep itself remains untested.

### Current image artifacts

These are private test artifacts in the approved workspace, not public releases. Explicit optimization was disabled; activation performed the necessary preparation.

| Artifact                 | Name / version / ID                                     | OCI digest                                                                |
| ------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------- |
| Final base               | `notus/base-herdr-0.9.0-c7hy46`, v4, `dvmo12qd4hcai`    | `sha256:1e2466f7f033dda37f66c238cdaf468403f0b347c11b63948db42a40c71db173` |
| Final derived            | `notus/derived-herdr-0.9.0-c7hy46`, v2, `34p86ifvt80gu` | `sha256:30ee237fb17282a20047a0f96f6bfad5197d720b06d46587af12c94b367a2d62` |
| Command runtime          | `notus/base-herdr-0.9.0-biv7fr`, v2, `39tnq5bmus4ti`    | `sha256:ea44b45df6be913b4812637b119e86ee2666efb5a3f427b6b18f28fe8fd70f6c` |
| Checkout runtime         | `notus/base-herdr-0.9.0-biv7fr`, v3, `s9fs9s20rv2sq`    | `sha256:a956fd5384ff47395358d4531c1bc7ecd127e73abfcd2add8182a226fb8deccf` |
| Push runtime             | `notus/base-herdr-0.9.0-biv7fr`, v4, `2qtklm7748g70`    | `sha256:a426fdbf7c9eb2fdca49083ca1960fccedad25ff07481217b13956cd6f8df75f` |
| Policy-decoupled runtime | `notus/base-herdr-0.9.0-biv7fr`, v5, `8d1dqu5v08l18`    | `sha256:32876cdc5fff0ce293d9e1aeb3b52354a54d41c955723fe9d2f2aaca813888a6` |

Full base reference:

```text
nscr.io/<tenant>/notus/base-herdr-0.9.0-c7hy46@sha256:1e2466f7f033dda37f66c238cdaf468403f0b347c11b63948db42a40c71db173
```

The final derived remote build used that exact base digest and installed `jq`. It was not launched. Earlier failing numeric-user versions and the one-change diagnostic image remain as named evidence, enumerated in the temporary report. Do not use earlier artifacts as the corrected base.

### Verification and cleanup

Both baseline and final images passed network-disabled local AMD64 readiness, permissions, bundle integrity and SIGTERM/SIGINT/SIGHUP cleanup under ARM64 emulation. Runtime source and migrations did not change in this investigation. The preceding diagnostic cleanup passed 139 offline checks and five P2 tests, recorded in `/tmp/notus-check-regression-path.txt` and `/tmp/notus-owned-regression/`. Parent verification of the current tree found zero lint diagnostics and passed all 13 uncached workspace typechecks, root typechecking and diff checks.

| Devbox                   | ID              | Result                                             | Cleanup               |
| ------------------------ | --------------- | -------------------------------------------------- | --------------------- |
| `notus-baseline-c7hy46`  | `8j31t5a8rhsn6` | Reproduced container deadline                      | Expire 200, Fetch 404 |
| `notus-nameduser-c7hy46` | `c79b9u6u5rfe0` | Initial readiness passed; restart readiness failed | Expire 200, Fetch 404 |
| `notus-final-c7hy46`     | `n92jcfc4vhati` | Final automatic session readiness passed           | Expire 200, Fetch 404 |

A first named-user Create hit the account's one-devbox limit with HTTP 429. Fetch confirmed no creation, and the next attempt followed baseline expiry. No quota or account policy changed. Final inventory showed no devboxes, temporary credential directories or test containers. Published images were retained. No support request was sent.

## Initial implementation

- Workspaces stores one default environment per workspace: provider key, opaque JSON and a monotonically increasing revision. Only the provider package interprets native settings. Returned snapshots are detached and frozen. No public administration endpoint was added.
- A shared JSON snapshot helper rejects serialization hooks, accessors, cycles and unsupported object properties before they can change validated data. It preserves ordinary JSON keys, including `__proto__` and `constructor`.
- `@notus/namespace` provides a fetch-based native JSON codec and Create/Fetch/Activate/Stop/Expire client. Credentials and the trusted endpoint are supplied separately. It has no SDK or Node transport dependency, no mutation retries, bounded operations and sanitized failures.
- `@notus/herdr` implements native local ping/snapshot readiness. `apps/devbox` owns the foreground supervisor and extensible image. Neither launches an agent or calls a model.
- The generated D1 migration is `apps/api/src/migrations/d1/20260913092923_groovy_norrin_radd/migration.sql`. It remains Drizzle's output; the user declined an additional manual NULL guard. Regeneration reported no changes. It has not been applied to the deployed Cloudflare database in this slice.

The deployed Slack simulation was not changed or redeployed. The user separately confirmed it works after the Notus rename. No automatic Namespace provisioning was connected to Slack or task execution.

## Initial local checks

| Check                                            | Result                                                            |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| Native workerd/D1 environment checks             | 65/65 passed                                                      |
| Existing durability/intake/Slack checks          | 74/74 passed                                                      |
| JSON-boundary regression tests                   | 5/5 tests, 113 assertions passed                                  |
| Unexpected outbound calls in offline suites      | 0                                                                 |
| Audited source-hash drift                        | 0                                                                 |
| Scoped lint                                      | 0 errors, 23 advisory warnings                                    |
| Frozen install, scoped formatting and diff check | Passed                                                            |
| Uncached workspace typechecks                    | All 13 workspaces and root passed                                 |
| Final Linux AMD64 image                          | Built; both download checksums verified                           |
| Image readiness without network                  | Native Herdr 0.9.0/protocol 22 ping and snapshot passed, UID 1001 |
| Supervisor termination                           | SIGTERM, SIGINT and SIGHUP cleanup/restart passed                 |

Linux container tests ran under AMD64 emulation on an ARM64 host. Final image checks confirmed a readable, non-writable runtime bundle for UID 1001, mode-0700 state, no `/.namespace/tasks` marker and scope cleanup before exit. Effect rc.112 uses exit 130 for interruption-only shutdown; this is not a forced-kill result.

Review and image tests found and fixed:

- Hidden `toJSON` methods could replace validated JSON, including injecting a reserved environment name. The inert snapshot now rejects these inputs without invoking their hooks.
- Docker `COPY --chmod=0644` created untraversable parent directories. The image now creates those directories explicitly with mode 0755.
- SIGHUP bypassed BunRuntime's SIGINT/SIGTERM handling and orphaned Herdr. A scoped SIGHUP listener now interrupts the same main fiber and allows finalizers to reap the child and release ownership.

No repository test files were added. Machine-local evidence:

- `/tmp/notus-final-offline-n_mu954i/REPORT.md`: final native checks, original regression assertions, JSON regressions, hashes and command history. A temporary harness assertion involving timing metadata was corrected; its failure history remains recorded.
- `/tmp/notus-sighup-evidence/`: before/after Linux termination checks and listener cleanup.
- `/tmp/notus-devbox-qeZSFR/`: image checks, current workerd bundle/provenance, scoped live scripts, creation intent and lifecycle receipts.

## Earlier image artifacts

The user approved the already authenticated Namespace workspace `<namespace-tenant>`. Images are private workspace artifacts, not public Notus releases.

| Artifact                   | Name / ID                                            | OCI digest                                                                |
| -------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------- |
| Reviewed base, version 2   | `notus/base-herdr-0.9.0-qezsfr` / `c2thg5so6jcf8`    | `sha256:f817b2f6a82fece6c340acbaa8c536c4158880415bf3a719eff77086addb7db2` |
| Derived example, version 1 | `notus/derived-herdr-0.9.0-qezsfr` / `m5aoqermlfv0u` | `sha256:3d9b2a58e83f556f01943f28c13104b58dcdf4498cb0f7633dd50c3648eee2f0` |

The base's full reference is:

```text
nscr.io/<tenant>/notus/base-herdr-0.9.0-qezsfr@sha256:f817b2f6a82fece6c340acbaa8c536c4158880415bf3a719eff77086addb7db2
```

Namespace's remote builder successfully used that exact reference in the derived Dockerfile and installed `jq`. Capabilities were supplied again during registration. The derived image was published with optimization disabled; no second VM was launched after the base startup failure.

The reviewed base completed Namespace image optimization. Its runtime bundle SHA256 is `fd4a0f682b94a045931b6f1e9d7cd7757c183888ac1dde28893fc83a915453ab`. Herdr and Bun release pins are in the Dockerfile and [source inventory](sources.md). Ubuntu's AMD64 manifest is pinned; apt repositories remain mutable, so this is not a bit-for-bit reproducible-build claim.

An earlier base version 1 remains in the image history. It predates the SIGHUP fix and is not the reference above. Published image artifacts were retained; disposable test containers were removed. The final Namespace listing showed no devboxes in the selected user's scope, and no temporary Namespace credential directories remained.

## Initial live failure

The private probe ran the actual provider and workspace services in local workerd, with native D1 storage and unpatched Effect rc.112. It did not deploy a public Worker endpoint or a Node control intermediary. The host issued a short-lived Namespace credential through the official SDK's explicit user-login loader, checked the approved tenant, and supplied the token in memory to workerd. Credentials were neither printed nor embedded in source/images. CLI invocations used temporary mode-0600 token files for the same tenant.

1. A local Miniflare module-path failure occurred before request dispatch. Loading the audited bundle inline removed that harness failure.
2. The live Create API rejected the newer SDK's `machineSize` setting with `instance shape is missing`. The test supplied the native `instanceShape` directly: four vCPUs, 8192 MiB, AMD64/Linux. No shared size-to-shape translation was added.
3. Create succeeded from the persisted opaque configuration at revision 3. It returned devbox `9mln5fk1q42hc`, named `notus-base-qezsfr`, stopped and bound to the reviewed base image version 2. Earlier revisions correspond to the rejected test requests, not successful extra creations.
4. Activate exceeded the probe's 120-second deadline and returned an explicit unknown outcome. The probe did not recreate the devbox. Fetch reconciled the same ID and found a backing instance; that observation did not establish container or Herdr readiness.
5. Read-only inspection found backing instance `i690n2435amoc`. Namespace reported VM creation at `10:08:36.478Z` and readiness at `10:08:41.354Z`, about 4.88 seconds later. It subsequently reported container `devbox` with `containerFailedReason: NotCreatedWithinDeadline`. The backend destroyed that instance at `10:13:59.088Z`.
6. A native CLI readiness attempt failed with `FailedPrecondition`. Herdr never became reachable in this devbox. Sanitized inspection of 386 log records did not establish the underlying container-creation error.
7. Expire succeeded through the provider client after verifying the stored devbox ID/name. The disposable devbox is no longer needed or retained for execution.

The test requested private access, non-privileged execution, no repository checkout and no optional integrations. It supplied a harmless `PROJECT_VARIANT` environment value, but delivery of that value could not be verified because the container never became reachable. No model credentials, prompts, repository code or real tasks were sent.

### Registration limitation

Namespace CLI `0.0.185` reported `setupDockerClient: true` despite the capabilities file supplying false. Later native `WireImage` probes and successful Docker-enabled boots are recorded above. They disprove a CLI-only explanation and do not establish Docker setup as the startup cause. Do not claim host/socket isolation from the image recipe.

## Remaining gates

- Wire trusted startup-session settings into the provider launch path without giving opaque user configuration authority over reserved bootstrap settings. The successful raw native probe is not that integration.
- Verify a derived-image runtime, automatic session restart, safe stale-ownership handling and auto-sleep. Initial startup and configuration delivery now pass; stop/start readiness does not.
- Establish initiator model authorization, broker support, repository-code isolation, authenticated attempt binding, durable provisioning/reconciliation and result acceptance before enabling real execution.
- The current supervisor deliberately uses fresh native state and fails closed after forced host loss. It is not yet a task-resume implementation.

No model execution, GitHub or approval integration, production deployment, merge, or commitment of the working tree occurred.

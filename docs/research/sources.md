# Sources and versions

Initial research observations date to 2026-09-12. This inventory owns version numbers, upstream revisions, and update commands for research. Web pages and registry results can change independently of these snapshots. Source/test inspection is not a runtime test.

## Vendored source

These six research references are squashed Git subtrees. The initial review compared their trees with the recorded upstream commits and reported exact matches. Alchemy's `distilled` and `floci` gitlinks are uninitialized, not bundled source.

| Directory under `repos/` | Upstream | Ref | Revision |
| --- | --- | --- | --- |
| `effect` | https://github.com/Effect-TS/effect | `main` | `51d4a2f08a5c7691dc876415bc9fc0ecf467e153` |
| `herdr-ts-sdk` | https://github.com/dmmulroy/herdr-ts-sdk | `main` | `77abbf81ac35407bc5138a8f4fe19f0833af4402` |
| `herdr` | https://github.com/herdrdev/herdr | `master` | `a5d5f6f654a32b27b2bd4dd8edd82f6795359269` |
| `plannotator` | https://github.com/backnotprop/plannotator | `main` | `0f2bd6051c66d26f2d776a2a521d856627b3316c` |
| `namespace-sdk` | https://github.com/namespacelabs/typescript-sdk | `main` | `a72324a20c4c6402960a2fd4ed6382624691b8d9` |
| `alchemy` | https://github.com/alchemy-run/alchemy | `main` | `e6c5a3838f742443164a86708e2e4abca781aa92` |

## Compatibility inventory

Manifest values were rechecked during consolidation. Registry observations below belong to the initial review, not a new release check.

| Component | Observed versions and constraints | Evidence |
| --- | --- | --- |
| Bridle Effect ecosystem | Root catalog and inspected Effect packages use `4.0.0-rc.115` | `package.json`; `repos/effect/packages/{effect,ai/openai,platform/node,sql/sqlite-do}/package.json` |
| Effect Node runtime | Manifest says Node `>=18`; locked `undici@8.10.2` requires Node `>=22.19.0` | `repos/effect/packages/platform/node/package.json`; `repos/effect/pnpm-lock.yaml` |
| Herdr | `0.9.0`, protocol `22`, Rust `1.96.1` | `repos/herdr/Cargo.toml`, `rust-toolchain.toml`, `src/protocol/wire.rs` |
| Herdr SDK | `@herdr/sdk@0.9.0`, Node `>=20`; direct dependencies on Effect and node-shared `4.0.0-beta.105`; protocol `22` | `repos/herdr-ts-sdk/package.json`; expected Herdr commit `b99002ac99b09e00b4ca692436cb15a6b0d676f1`, different from our subtree |
| Namespace SDK | Source `1.1.0`; public npm `latest` was `1.0.0`, without `/devbox` or `createDevboxClient` | `repos/namespace-sdk/package.json`; [registry](https://registry.npmjs.org/@namespacelabs%2fsdk) |
| Namespace transport | Lockfile resolves connect-node `2.1.1`, Node `>=20`; SDK has no engine declaration; publishing uses Node 22 | `repos/namespace-sdk/package-lock.json`; `.github/workflows/npm-publish.yaml` |
| Plannotator | Root `0.27.14`; standalone binary bundles Bun; source build needs Bun and UI assets | `repos/plannotator/package.json`, `README.md` |
| Plannotator hosts | Pi peer `@earendil-works/pi-coding-agent >=0.79.1`; OpenCode 2 support experimental, no host peer range; Claude hook handles `>=2.1.199` updated-input requirement | `apps/pi-extension/package.json`, `apps/opencode-plugin/{package.json,README.md}`, `apps/hook/server/index.ts` under `repos/plannotator/` |
| Alchemy | Root catalog and source `2.0.0-beta.77`; upstream Effect catalog `>=4.0.0-rc.115 || >=4.0.0`, override `4.0.0-rc.115` | `package.json`; `repos/alchemy/{pnpm-workspace.yaml,packages/alchemy/package.json}` |
| Distilled Slack/core | Published `1.0.0-rc.9`; Slack declares Effect `>=4.0.0-rc.112 || >=4.0.0` | [metadata](https://registry.npmjs.org/@distilled.cloud%2fslack/1.0.0-rc.9) |
| Codex automation minimums | Service-account tokens require CLI `0.142.0+`; workload identity requires `0.148.0+` | [service accounts](https://learn.chatgpt.com/docs/enterprise/service-accounts), [federation](https://learn.chatgpt.com/docs/enterprise/workload-identity) |

The Herdr SDK README calls its baseline unpublished. That is not a registry check. Matching protocol schemas do not resolve its Effect dependency mismatch. No tested normal-package dependency set has been established.

### Additional source snapshots

- [Codex SDK README](https://github.com/openai/codex/blob/53c542d944c705f3a66780a19223223bee57cbb6/sdk/typescript/README.md) and [license](https://github.com/openai/codex/blob/53c542d944c705f3a66780a19223223bee57cbb6/LICENSE), remote snapshot only, not a recommended release.
- The former `erudane-auth.md` cited local commit `4be8c4137cd4e340f4a8e530517557981ab78311` and Effect `4.0.0-rc.111`. That commit and its cited model/stack files are absent from this checkout. [OpenAI notes](openai-auth.md#local-implementation-evidence) retain the reported behavior with that qualification.
- [Namespace package archive](https://registry.npmjs.org/@namespacelabs/sdk/-/sdk-1.0.0.tgz), reported Git head `b0c28cc9d73dd3c37651ff0c5b22b1e843a8fd45`. Integrity `sha512-baAbAIFhwwdzvPsLhytnaI2TcAFJP3ugTuOu0LlaDaRVIfUPirWy+WgTJfo1rtmQwXNiXuHSTuVbsq4Q7fTk5w==`.
- [connect-node archive](https://registry.npmjs.org/@connectrpc/connect-node/-/connect-node-2.1.1.tgz), inspected for HTTP socket and gRPC transport behavior.
- [Distilled Slack archive](https://registry.npmjs.org/@distilled.cloud/slack/-/slack-1.0.0-rc.9.tgz). Integrity `sha512-6xKUvqS0ApQ4A0Rq49MP9Jjwc0+1Gn+sMfaxv1AaZ0LTq959OasGepNIqXTSYT6DNKI7imcVWws3jTGI3wYYqw==`. Slack/core archives were inspected as data, not installed or executed.

## Updates and distribution

Keep `repos/` read-only during implementation. Use normal dependencies or separately built pinned artifacts, never imports from a subtree. An authorized reference refresh uses the directory, URL, and ref above:

```sh
git subtree pull --prefix=repos/effect \
  https://github.com/Effect-TS/effect.git main --squash
```

Subtree updates create commits. Begin with a clean tree, update this inventory, and recheck affected evidence. Updating sources does not update the root catalog or prove compatibility. Build upstream artifacts in a separate checkout, not `repos/`.

Top-level licenses: Effect and Herdr SDK MIT; Herdr and Alchemy Apache-2.0; Plannotator MIT OR Apache-2.0. Namespace declares Apache-2.0, but the inspected tree and public archive lack the advertised standalone license file. Confirm that before redistribution. These are not transitive license/SBOM audits or hosted-service entitlements. Plannotator's `SECURITY.md` supports only its latest released version for security fixes.

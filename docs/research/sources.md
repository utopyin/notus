# Source inventory

Research date: 2026-09-12. Local source references in this folder refer to the revisions below, not moving upstream branches.

## Vendored repositories

These are squashed Git subtrees, not submodules or nested clones. Their ordinary tracked files are available after a normal checkout. Alchemy's upstream `distilled` and `floci` submodules remain uninitialized gitlinks; they are not bundled source. The bootstrap and subtree imports are committed; research documents are maintained separately.

| Local directory | Upstream | Imported ref | Upstream revision |
| --- | --- | --- | --- |
| `repos/effect` | https://github.com/Effect-TS/effect | `main` | `51d4a2f08a5c7691dc876415bc9fc0ecf467e153` |
| `repos/herdr-ts-sdk` | https://github.com/dmmulroy/herdr-ts-sdk | `main` | `77abbf81ac35407bc5138a8f4fe19f0833af4402` |
| `repos/herdr` | https://github.com/herdrdev/herdr | `master` | `a5d5f6f654a32b27b2bd4dd8edd82f6795359269` |
| `repos/plannotator` | https://github.com/backnotprop/plannotator | `main` | `0f2bd6051c66d26f2d776a2a521d856627b3316c` |
| `repos/namespace-sdk` | https://github.com/namespacelabs/typescript-sdk | `main` | `a72324a20c4c6402960a2fd4ed6382624691b8d9` |
| `repos/alchemy` | https://github.com/alchemy-run/alchemy | `main` | `e6c5a3838f742443164a86708e2e4abca781aa92` |

The Namespace SDK repository was resolved through Namespace's API/SDK documentation. Herdr and Plannotator implementation repositories were resolved through their supplied documentation.

## Observed package versions

- Effect core: `4.0.0-rc.115` in `repos/effect/packages/effect/package.json`.
- Herdr TypeScript SDK: `@herdr/sdk@0.9.0`, with exact dependencies on `effect@4.0.0-beta.105` and `@effect/platform-node-shared@4.0.0-beta.105`. These differ from the imported Effect revision.
- Namespace SDK: `@namespacelabs/sdk@1.1.0`.
- Plannotator root package: `0.27.14`.
- Alchemy: `2.0.0-beta.77`, the Effect-based v2 implementation. Its workspace overrides core Effect to `4.0.0-rc.115`.

These are source manifest versions, not evidence that every package or binary has been published and tested together. All six imported subtree trees were compared against their recorded upstream commit trees and matched exactly.

## Updating references

Keep the working tree clean before a subtree update. For example:

```sh
git subtree pull --prefix=repos/effect \
  https://github.com/Effect-TS/effect.git main --squash
```

Use the corresponding directory, URL, and branch from the table for other repositories. Updates create Git commits. After an update, revise this inventory and recheck affected research claims. Never infer the installed package version from a repository name or branch alone.

See the [Effect subtree article](https://effect.website/blog/the-one-weird-git-trick-that-makes-coding-agents-more-effect-ive) for the approach. `AGENTS.md` marks these sources read-only, and `.vscode/settings.json` excludes them from editor auto-imports and ordinary editor searches. Agent tools can still read them directly.

## User-provided starting documentation

- https://alchemy.run
- https://namespace.so/docs/devbox
- https://namespace.so/docs/reference/typescript-sdk
- https://docs.plannotator.ai/open-source/start/installation
- https://herdr.dev/agent-guide.md
- https://github.com/dmmulroy/herdr-ts-sdk
- https://github.com/Effect-TS/effect
- https://github.com/Effect-TS/effect/tree/main/packages/ai
- https://github.com/Effect-TS/effect/tree/main/packages/effect/src/unstable/ai

Individual research notes record additional primary sources and distinguish source inspection from runtime validation. Web documentation can change independently of these pinned sources.

## Scope of this checkout

Vendoring does not install dependencies, execute upstream installers, authenticate services, or create cloud resources. These sources are reference material, not Bridle application packages. Upstream license files are preserved where provided. Namespace's SDK manifest declares Apache-2.0 but its inspected tree lacks the advertised standalone license file; see the Namespace report before redistributing it.

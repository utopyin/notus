# Reference sources

`repos/` holds read-only squashed Git subtrees of upstream projects, kept for reading source. Application code never imports them; [package.json](../package.json) owns the dependency versions actually used.

| Directory under `repos/` | Upstream                                        | Ref      | Revision                                   |
| ------------------------ | ----------------------------------------------- | -------- | ------------------------------------------ |
| `effect`                 | https://github.com/Effect-TS/effect             | `main`   | `7f32606baac43a67d171ae93b77c7b29791c9692` |
| `herdr-ts-sdk`           | https://github.com/dmmulroy/herdr-ts-sdk        | `main`   | `77abbf81ac35407bc5138a8f4fe19f0833af4402` |
| `herdr`                  | https://github.com/herdrdev/herdr               | `master` | `a5d5f6f654a32b27b2bd4dd8edd82f6795359269` |
| `plannotator`            | https://github.com/backnotprop/plannotator      | `main`   | `0f2bd6051c66d26f2d776a2a521d856627b3316c` |
| `namespace-sdk`          | https://github.com/namespacelabs/typescript-sdk | `main`   | `a72324a20c4c6402960a2fd4ed6382624691b8d9` |
| `alchemy`                | https://github.com/alchemy-run/alchemy          | `main`   | `9e3c0584342d67b24a4215f931047aabd230327b` |

## Updating

Start from a clean tree and pull with the directory, URL and ref above, then update the revision here:

```sh
git subtree pull --prefix=repos/effect \
  https://github.com/Effect-TS/effect.git main --squash
```

## Patches

`patches/drizzle-orm@1.0.0-rc.5-5935859.patch` renames `Schema.isLengthBetween` to `isBetweenLength` for Effect 4. Drop it when bumping to a Drizzle build that includes drizzle-team/drizzle-orm#6429. The root `tsconfig.json` maps `effect/unstable/sql/SqlError` to `effect/sql/SqlError` for the same Drizzle builds.

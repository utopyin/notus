import { defineConfig, type DummyRuleMap } from "oxlint";
import { recommended } from "@effect/tsgo/oxlint-presets";

const statementPaddingFiles = ["apps", "domains", "entrypoints", "packages", "scripts"].flatMap(
  (root) => ["ts", "mts", "cts"].map((extension) => `${root}/**/*.${extension}`),
);

export default defineConfig({
  jsPlugins: ["./scripts/lint.ts"],
  ignorePatterns: ["repos", "**/routeTree.gen.ts", "**/dist/**"],
  extends: [recommended],
  overrides: [
    {
      files: statementPaddingFiles,
      rules: {
        "notus/statement-padding": "error",
      },
    },
    {
      // React and TanStack code, and Better Auth callbacks, are Promise-based by contract.
      files: ["apps/web/**/*", "packages/ui/**/*", "packages/db/**/*", "apps/dashboard/**/*"],
      rules: Object.keys(recommended.rules ?? {}).reduce((acc, key) => {
        acc[key] = "off";
        return acc;
      }, {} as DummyRuleMap),
    },
    {
      // Dashboard components derive from props and stores; nothing reacts to a state change with
      // a side effect. Subscriptions go through useSyncExternalStore or TanStack's hooks.
      files: ["apps/dashboard/**/*"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: [
              {
                name: "react",
                importNames: ["useEffect", "useLayoutEffect"],
                message:
                  "No effects in the dashboard: derive from props and stores, subscribe with useSyncExternalStore, and use @tanstack/react-hotkeys for shortcuts.",
              },
            ],
          },
        ],
      },
    },
  ],
  rules: {
    "import/extensions": ["error", "never"],
    // Effect 4 keeps http, ai and process `@stability unstable`; using them is a settled choice.
    "effecttsgo/unstable-api-usage": "off",
    "effecttsgo/return-effect-in-gen": "off",
    "effecttsgo/schema-class-missing-brand": "off",
  },
});

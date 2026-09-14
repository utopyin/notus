import { defineConfig, type DummyRuleMap } from "oxlint";
import { recommended } from "@effect/tsgo/oxlint-presets";

export default defineConfig({
  ignorePatterns: ["repos", "**/routeTree.gen.ts", "**/dist/**"],
  extends: [recommended],
  overrides: [
    {
      // React and TanStack code, and Better Auth callbacks, are Promise-based by contract.
      files: ["apps/web/**/*", "packages/ui/**/*", "packages/db/**/*", "apps/dashboard/**/*"],
      rules: Object.keys(recommended.rules ?? {}).reduce((acc, key) => {
        acc[key] = "off";
        return acc;
      }, {} as DummyRuleMap),
    },
  ],
  rules: {
    "import/extensions": ["error", "never"],
  },
});

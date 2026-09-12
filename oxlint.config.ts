import { defineConfig, type DummyRuleMap } from "oxlint";
import { recommended } from "@effect/tsgo/oxlint-presets";

export default defineConfig({
  ignorePatterns: ["repos", "**/routeTree.gen.ts"],
  extends: [recommended],
  overrides: [
    {
      files: ["apps/web/**/*", "packages/ui/**/*", "packages/db/**/*"],
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

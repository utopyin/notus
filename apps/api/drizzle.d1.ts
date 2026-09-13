import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: [
    "../../domains/accounts/src/schema.ts",
    "../../domains/workspaces/src/schema.ts",
    "../../entrypoints/control/src/schema.ts",
  ],
  out: "./src/migrations/d1",
});

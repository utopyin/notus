import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  driver: "durable-sqlite",
  schema: ["../../domains/tasks/src/schema.ts", "../../domains/executions/src/schema.ts"],
  out: "./src/migrations/task",
});

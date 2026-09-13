import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  driver: "durable-sqlite",
  schema: ["../../domains/accounts/src/connection.ts"],
  out: "./src/migrations/connection",
});

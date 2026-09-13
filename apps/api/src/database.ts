import { Database } from "alchemy/Cloudflare/D1";

// Deploy from the repository root. Resource props also evaluate in workerd,
// where import.meta.url is not a file URL. Alchemy owns __alchemy_migrations.
export const SharedDatabase = Database("SharedDatabase", {
  migrations: "./apps/api/src/migrations/d1",
  readReplication: { mode: "disabled" },
});

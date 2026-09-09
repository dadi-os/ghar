/** Apply Drizzle migrations and seed the unassigned room. */

import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { migrate as runMigrate } from "drizzle-orm/postgres-js/migrator";
import { loadDatabaseConfig } from "../config.js";
import { createDb } from "./client.js";
import { seed } from "./seed.js";

export async function migrate(config: {
  serviceRoot: string;
  env: { databaseUrl: string };
}): Promise<void> {
  const { client, db } = createDb(config.env.databaseUrl);
  try {
    await runMigrate(db, { migrationsFolder: join(config.serviceRoot, "drizzle") });
    await seed(db);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await migrate(loadDatabaseConfig());
}

/**
 * Process entry: migrate, listen, then bring up the Matter controller.
 * HTTP listens before Matter is ready; command and commission routes fail
 * loudly at the point of use until `FabricController.start` succeeds.
 */

import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { migrate } from "./db/migrate.js";
import { createLogger } from "./logging.js";
import { FabricController } from "./matter/controller.js";

const log = createLogger();
const config = loadConfig();

await migrate(config);
const { client, db } = createDb(config.env.databaseUrl);

const fabric = new FabricController({
  db,
  log,
  matterStoragePath: config.env.matterStoragePath,
});

const app = await buildApp(config, {
  db,
  sql: client,
  controller: fabric,
});

const shutdown = async (signal: string) => {
  log.info("shutting down", { signal });
  await app.close();
  await fabric.stop();
  await client.end();
};

process.on("SIGINT", () => {
  void shutdown("SIGINT").then(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM").then(() => process.exit(0));
});

await app.listen({ host: config.env.host, port: config.env.port });
log.info("ghar listening", { host: config.env.host, port: config.env.port });

void fabric
  .start()
  .then(() => {
    log.info("matter controller ready");
  })
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    log.error("matter controller failed to start", { err: message });
  });

/** Typed process config. The only module that reads the environment. */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const serviceRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export type Config = {
  serviceRoot: string;
  env: {
    databaseUrl: string;
  };
};

let cached: Config | undefined;

/** Clear the memoized config (tests only). */
export function resetConfigCache(): void {
  cached = undefined;
}

/**
 * Load process config from required env.
 * @throws When DATABASE_URL is missing.
 */
export function loadConfig(): Config {
  if (cached) {
    return cached;
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  cached = {
    serviceRoot,
    env: { databaseUrl },
  };
  return cached;
}

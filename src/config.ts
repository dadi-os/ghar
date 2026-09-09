/** Typed process config. The only module that reads the environment or config.toml. */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";
import { z } from "zod";
import { HOST, LOG_LEVEL, PORT } from "./constants.js";

const serviceRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const tomlPath = join(serviceRoot, "config.toml");

const fileSchema = z.object({
  page: z.object({
    default_size: z.number().int().positive(),
    max_size: z.number().int().positive(),
  }),
});

export type FileConfig = z.infer<typeof fileSchema>;

export type Config = {
  serviceRoot: string;
  env: {
    databaseUrl: string;
    /** Persistent Matter fabric storage. Required when starting the real controller. */
    matterStoragePath: string;
    host: string;
    port: number;
    logLevel: typeof LOG_LEVEL;
  };
  page: FileConfig["page"];
};

export function loadFileConfig(): FileConfig {
  let raw: string;
  try {
    raw = readFileSync(tomlPath, "utf8");
  } catch {
    throw new Error(`missing config file: ${tomlPath}`);
  }
  const parsed = fileSchema.safeParse(parseToml(raw));
  if (!parsed.success) {
    throw new Error(`invalid config.toml: ${parsed.error.message}`);
  }
  if (parsed.data.page.default_size > parsed.data.page.max_size) {
    throw new Error("config.toml page.default_size must be <= page.max_size");
  }
  return parsed.data;
}

let cached: Config | undefined;

/** Clear the memoized config (tests only). */
export function resetConfigCache(): void {
  cached = undefined;
}

/**
 * Load process config from config.toml and required env.
 * @throws When config.toml is invalid or required env is missing.
 */
export function loadConfig(): Config {
  if (cached) {
    return cached;
  }
  const file = loadFileConfig();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  const matterStoragePath = process.env.MATTER_STORAGE_PATH;
  if (!matterStoragePath) {
    throw new Error("MATTER_STORAGE_PATH is required");
  }
  cached = {
    serviceRoot,
    env: {
      databaseUrl,
      matterStoragePath,
      host: listenHost(),
      port: listenPort(),
      logLevel: LOG_LEVEL,
    },
    page: file.page,
  };
  return cached;
}

/**
 * HTTP bind host. Prod host-networked Ghar sets HOST=127.0.0.1 so the
 * listener, not a container network, is the boundary around the fabric.
 */
function listenHost(): string {
  const value = process.env.HOST;
  if (value !== undefined && value.length > 0) {
    return value;
  }
  return HOST;
}

/** HTTP bind port. Prod host-networked Ghar sets PORT=8084. */
function listenPort(): number {
  const value = process.env.PORT;
  if (value === undefined || value.length === 0) {
    return PORT;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`invalid PORT: ${value}`);
  }
  return parsed;
}

/**
 * Config for migrate that only needs Postgres.
 * @throws When DATABASE_URL is missing.
 */
export function loadDatabaseConfig(): {
  serviceRoot: string;
  env: { databaseUrl: string };
} {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  return {
    serviceRoot,
    env: { databaseUrl },
  };
}

import { loadConfig, resetConfigCache, type Config } from "../src/config.js";
import { createDb, type Db, type Sql } from "../src/db/client.js";
import { deviceCapabilities, devices } from "../src/db/schema.js";
import { eq } from "drizzle-orm";
import type { DeviceKind, GharCapability } from "../src/matter/capabilities.js";

/** Test config against real Postgres; Matter path is unused with FakeController. */
export function testConfig(): Config {
  resetConfigCache();
  if (!process.env.MATTER_STORAGE_PATH) {
    process.env.MATTER_STORAGE_PATH = "/tmp/ghar-test-matter";
  }
  if (!process.env.DWAR_URL) {
    process.env.DWAR_URL = "http://dwar.test";
  }
  return loadConfig();
}

export async function openTestDb(): Promise<{ db: Db; sql: Sql; close: () => Promise<void> }> {
  const config = testConfig();
  const { client, db } = createDb(config.env.databaseUrl);
  return {
    db,
    sql: client,
    close: () => client.end(),
  };
}

export async function truncateAll(sql: Sql): Promise<void> {
  await sql`TRUNCATE event_logs, device_tags, device_capabilities, devices, tags CASCADE`;
}

export async function insertTestDevice(
  db: Db,
  args: {
    name: string;
    nodeId?: bigint;
    endpoint?: number;
    kind?: DeviceKind;
    capabilities?: Array<{ capability: GharCapability; config?: Record<string, unknown> }>;
    online?: boolean;
  },
): Promise<string> {
  const inserted = await db
    .insert(devices)
    .values({
      nodeId: args.nodeId ?? BigInt(Math.floor(Math.random() * 1_000_000)),
      endpoint: args.endpoint ?? 1,
      name: args.name,
      kind: args.kind ?? "light",
      deviceTypes: [],
      online: args.online ?? true,
      vendorName: "TestVendor",
      productName: "TestProduct",
    })
    .returning({ id: devices.id });
  const row = inserted[0];
  if (!row) {
    throw new Error("device insert failed");
  }
  const caps = args.capabilities ?? [{ capability: "on_off" as const, config: {} }];
  if (caps.length > 0) {
    await db.insert(deviceCapabilities).values(
      caps.map((c) => ({
        deviceId: row.id,
        capability: c.capability,
        config: c.config ?? {},
      })),
    );
  }
  return row.id;
}

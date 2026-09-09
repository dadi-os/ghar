import { loadConfig, resetConfigCache, type Config } from "../src/config.js";
import { createDb, type Db, type Sql } from "../src/db/client.js";
import { deviceCapabilities, devices, rooms } from "../src/db/schema.js";
import { eq } from "drizzle-orm";

/** Test config against real Postgres; Matter path is unused with FakeController. */
export function testConfig(): Config {
  resetConfigCache();
  if (!process.env.MATTER_STORAGE_PATH) {
    process.env.MATTER_STORAGE_PATH = "/tmp/ghar-test-matter";
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
  await sql`TRUNCATE event_logs, device_tags, device_capabilities, devices, tags, rooms CASCADE`;
}

export async function unassignedRoomId(db: Db): Promise<string> {
  const rows = await db.select().from(rooms).where(eq(rooms.name, "unassigned"));
  const row = rows[0];
  if (!row) {
    throw new Error("unassigned room missing");
  }
  return row.id;
}

export async function insertTestDevice(
  db: Db,
  args: {
    name: string;
    nodeId?: bigint;
    endpoint?: number;
    roomId: string;
    capabilities?: Array<{ capability: "switchable" | "dimmable" | "colorable" | "sensor"; config?: Record<string, unknown> }>;
    online?: boolean;
  },
): Promise<string> {
  const inserted = await db
    .insert(devices)
    .values({
      nodeId: args.nodeId ?? BigInt(Math.floor(Math.random() * 1_000_000)),
      endpoint: args.endpoint ?? 1,
      name: args.name,
      roomId: args.roomId,
      online: args.online ?? true,
      vendorName: "TestVendor",
      productName: "TestProduct",
    })
    .returning({ id: devices.id });
  const row = inserted[0];
  if (!row) {
    throw new Error("device insert failed");
  }
  const caps = args.capabilities ?? [{ capability: "switchable" as const, config: {} }];
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

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import { loadConfig } from "../src/config.js";
import { createDb, type Db, type Sql } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import {
  deviceCapabilities,
  devices,
  deviceTags,
  eventLogs,
  rooms,
  tags,
} from "../src/db/schema.js";

const config = loadConfig();
const { client: sql, db } = createDb(config.env.databaseUrl);

/** Drizzle wraps driver errors; match against the outer message and its cause. */
function errorText(err: unknown): string {
  if (!(err instanceof Error)) {
    return String(err);
  }
  const cause = err.cause instanceof Error ? err.cause.message : "";
  return `${err.message}\n${cause}`;
}

async function truncateAll(sql: Sql): Promise<void> {
  await sql`TRUNCATE event_logs, device_tags, device_capabilities, devices, tags, rooms CASCADE`;
}

async function unassignedRoomId(db: Db): Promise<string> {
  const rows = await db.select().from(rooms).where(eq(rooms.name, "unassigned"));
  const row = rows[0];
  assert.ok(row, "unassigned room missing");
  return row.id;
}

async function insertDevice(
  db: Db,
  args: { nodeId: bigint; endpoint: number; name: string; roomId: string },
): Promise<string> {
  const rows = await db
    .insert(devices)
    .values({
      nodeId: args.nodeId,
      endpoint: args.endpoint,
      name: args.name,
      roomId: args.roomId,
    })
    .returning({ id: devices.id });
  const row = rows[0];
  assert.ok(row);
  return row.id;
}

before(async () => {
  await migrate(config);
});

after(async () => {
  await sql.end();
});

test("unassigned room exists after migration", async () => {
  const rows = await db.select().from(rooms).where(eq(rooms.name, "unassigned"));
  assert.equal(rows.length, 1);
});

test("inserting a device without a room fails", async () => {
  await assert.rejects(
    () =>
      sql`
        INSERT INTO devices (node_id, endpoint, name, room_id)
        VALUES (1, 1, 'orphan', NULL)
      `,
    (err: unknown) => {
      assert.match(errorText(err), /null value|not-null|violates/i);
      return true;
    },
  );
});

test("deleting a room that still has devices fails", async () => {
  await truncateAll(sql);
  await migrate(config);
  const roomId = await unassignedRoomId(db);
  await insertDevice(db, { nodeId: 10n, endpoint: 1, name: "bulb", roomId });

  await assert.rejects(
    () => db.delete(rooms).where(eq(rooms.id, roomId)),
    (err: unknown) => {
      assert.match(errorText(err), /restrict|foreign key|violates/i);
      return true;
    },
  );
});

test("devices may share node_id across endpoints; (node_id, endpoint) is unique", async () => {
  await truncateAll(sql);
  await migrate(config);
  const roomId = await unassignedRoomId(db);

  await insertDevice(db, { nodeId: 42n, endpoint: 1, name: "outlet-1", roomId });
  await insertDevice(db, { nodeId: 42n, endpoint: 2, name: "outlet-2", roomId });

  await assert.rejects(
    () => insertDevice(db, { nodeId: 42n, endpoint: 1, name: "dup", roomId }),
    (err: unknown) => {
      assert.match(errorText(err), /unique|duplicate/i);
      return true;
    },
  );
});

test("deleting a device cascades to capabilities, tags, and event logs", async () => {
  await truncateAll(sql);
  await migrate(config);
  const roomId = await unassignedRoomId(db);
  const deviceId = await insertDevice(db, {
    nodeId: 7n,
    endpoint: 1,
    name: "switch",
    roomId,
  });

  await db.insert(deviceCapabilities).values({
    deviceId,
    capability: "switchable",
    config: {},
  });

  const [tag] = await db.insert(tags).values({ name: "downstairs" }).returning();
  assert.ok(tag);
  await db.insert(deviceTags).values({ deviceId, tagId: tag.id });

  await db.insert(eventLogs).values({
    deviceId,
    attributeKey: "on",
    oldValue: false,
    newValue: true,
    cause: "user",
  });

  await db.delete(devices).where(eq(devices.id, deviceId));

  assert.equal((await db.select().from(deviceCapabilities)).length, 0);
  assert.equal((await db.select().from(deviceTags)).length, 0);
  assert.equal((await db.select().from(eventLogs)).length, 0);
  assert.equal((await db.select().from(tags)).length, 1);
});

test("a device cannot hold the same capability twice", async () => {
  await truncateAll(sql);
  await migrate(config);
  const roomId = await unassignedRoomId(db);
  const deviceId = await insertDevice(db, {
    nodeId: 3n,
    endpoint: 1,
    name: "lamp",
    roomId,
  });

  await db.insert(deviceCapabilities).values({
    deviceId,
    capability: "dimmable",
    config: { min: 1, max: 254 },
  });

  await assert.rejects(
    () =>
      db.insert(deviceCapabilities).values({
        deviceId,
        capability: "dimmable",
        config: {},
      }),
    (err: unknown) => {
      assert.match(errorText(err), /unique|duplicate|primary key/i);
      return true;
    },
  );
});

test("tag names are unique and a device cannot carry the same tag twice", async () => {
  await truncateAll(sql);
  await migrate(config);
  const roomId = await unassignedRoomId(db);
  const deviceId = await insertDevice(db, {
    nodeId: 5n,
    endpoint: 1,
    name: "plug",
    roomId,
  });

  const [tag] = await db.insert(tags).values({ name: "ambient" }).returning();
  assert.ok(tag);

  await assert.rejects(
    () => db.insert(tags).values({ name: "ambient" }),
    (err: unknown) => {
      assert.match(errorText(err), /unique|duplicate/i);
      return true;
    },
  );

  await db.insert(deviceTags).values({ deviceId, tagId: tag.id });
  await assert.rejects(
    () => db.insert(deviceTags).values({ deviceId, tagId: tag.id }),
    (err: unknown) => {
      assert.match(errorText(err), /unique|duplicate|primary key/i);
      return true;
    },
  );
});

test("event_logs ids increase monotonically across inserts", async () => {
  await truncateAll(sql);
  await migrate(config);
  const roomId = await unassignedRoomId(db);
  const deviceId = await insertDevice(db, {
    nodeId: 9n,
    endpoint: 1,
    name: "sensor",
    roomId,
  });

  const first = await db
    .insert(eventLogs)
    .values({
      deviceId,
      attributeKey: "occupancy",
      oldValue: null,
      newValue: true,
      cause: "external",
    })
    .returning({ id: eventLogs.id });
  const second = await db
    .insert(eventLogs)
    .values({
      deviceId,
      attributeKey: "occupancy",
      oldValue: true,
      newValue: false,
      cause: "external",
    })
    .returning({ id: eventLogs.id });

  assert.ok(first[0]);
  assert.ok(second[0]);
  assert.ok(second[0].id > first[0].id);
});

test("invalid capability or cause values are rejected by the enum", async () => {
  await truncateAll(sql);
  await migrate(config);
  const roomId = await unassignedRoomId(db);
  const deviceId = await insertDevice(db, {
    nodeId: 11n,
    endpoint: 1,
    name: "lock",
    roomId,
  });

  await assert.rejects(
    () =>
      sql`
        INSERT INTO device_capabilities (device_id, capability, config)
        VALUES (${deviceId}::uuid, 'camera', '{}'::jsonb)
      `,
    (err: unknown) => {
      assert.match(errorText(err), /invalid input value for enum|device_capability/i);
      return true;
    },
  );

  await assert.rejects(
    () =>
      sql`
        INSERT INTO event_logs (device_id, attribute_key, new_value, cause)
        VALUES (${deviceId}::uuid, 'locked', 'true'::jsonb, 'system')
      `,
    (err: unknown) => {
      assert.match(errorText(err), /invalid input value for enum|event_cause/i);
      return true;
    },
  );
});

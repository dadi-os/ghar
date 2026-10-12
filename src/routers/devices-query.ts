/** Load devices with room, tags, capabilities for API responses. */

import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  deviceCapabilities,
  devices,
  deviceTags,
  rooms,
  tags,
  type DeviceCapabilityRow,
  type DeviceRow,
  type RoomRow,
  type TagRow,
} from "../db/schema.js";
import { GharError } from "../errors.js";
import type { MatterController } from "../matter/controller-api.js";
import { toDeviceRecord } from "../serialize.js";
import type { DeviceRecord } from "../types/domain.js";

export type DeviceFilters = {
  room?: string | undefined;
  tag?: string | undefined;
  capability?: DeviceCapabilityRow["capability"] | undefined;
};

async function loadDeviceBundle(
  db: Db,
  deviceRows: DeviceRow[],
): Promise<{
  roomsById: Map<string, RoomRow>;
  capsByDevice: Map<string, DeviceCapabilityRow[]>;
  tagsByDevice: Map<string, TagRow[]>;
}> {
  const roomsById = new Map<string, RoomRow>();
  const capsByDevice = new Map<string, DeviceCapabilityRow[]>();
  const tagsByDevice = new Map<string, TagRow[]>();
  if (deviceRows.length === 0) {
    return { roomsById, capsByDevice, tagsByDevice };
  }

  const roomIds = [...new Set(deviceRows.map((d) => d.roomId))];
  const deviceIds = deviceRows.map((d) => d.id);

  const roomRows = await db.select().from(rooms).where(inArray(rooms.id, roomIds));
  for (const row of roomRows) {
    roomsById.set(row.id, row);
  }

  const capRows = await db
    .select()
    .from(deviceCapabilities)
    .where(inArray(deviceCapabilities.deviceId, deviceIds));
  for (const row of capRows) {
    const list = capsByDevice.get(row.deviceId) ?? [];
    list.push(row);
    capsByDevice.set(row.deviceId, list);
  }

  const tagJoin = await db
    .select({
      deviceId: deviceTags.deviceId,
      id: tags.id,
      name: tags.name,
    })
    .from(deviceTags)
    .innerJoin(tags, eq(deviceTags.tagId, tags.id))
    .where(inArray(deviceTags.deviceId, deviceIds));
  for (const row of tagJoin) {
    const list = tagsByDevice.get(row.deviceId) ?? [];
    list.push({ id: row.id, name: row.name });
    tagsByDevice.set(row.deviceId, list);
  }

  return { roomsById, capsByDevice, tagsByDevice };
}

function toRecord(
  device: DeviceRow,
  roomsById: Map<string, RoomRow>,
  capsByDevice: Map<string, DeviceCapabilityRow[]>,
  tagsByDevice: Map<string, TagRow[]>,
  controller: MatterController,
): DeviceRecord {
  const room = roomsById.get(device.roomId);
  if (!room) {
    throw new GharError(500, "internal_error", `device ${device.id} references missing room`);
  }
  return toDeviceRecord({
    id: device.id,
    nodeId: device.nodeId,
    endpoint: device.endpoint,
    name: device.name,
    online: device.online,
    lastSeenAt: device.lastSeenAt,
    vendorName: device.vendorName,
    productName: device.productName,
    room,
    tags: tagsByDevice.get(device.id) ?? [],
    capabilities: (capsByDevice.get(device.id) ?? []).map((c) => ({
      capability: c.capability,
      config: c.config,
    })),
    state: controller.getState(device.id),
  });
}

/** List devices with optional room/tag/capability filters. Unknown filters → empty list. */
export async function listDevices(
  db: Db,
  controller: MatterController,
  filters: DeviceFilters,
): Promise<DeviceRecord[]> {
  const conditions = [];

  if (filters.room !== undefined) {
    const roomRows = await db.select().from(rooms).where(eq(rooms.name, filters.room));
    const room = roomRows[0];
    if (!room) {
      return [];
    }
    conditions.push(eq(devices.roomId, room.id));
  }

  if (filters.tag !== undefined) {
    const tagRows = await db.select().from(tags).where(eq(tags.name, filters.tag));
    const tag = tagRows[0];
    if (!tag) {
      return [];
    }
    const tagged = await db
      .select({ deviceId: deviceTags.deviceId })
      .from(deviceTags)
      .where(eq(deviceTags.tagId, tag.id));
    if (tagged.length === 0) {
      return [];
    }
    conditions.push(
      inArray(
        devices.id,
        tagged.map((t) => t.deviceId),
      ),
    );
  }

  if (filters.capability !== undefined) {
    const capable = await db
      .select({ deviceId: deviceCapabilities.deviceId })
      .from(deviceCapabilities)
      .where(eq(deviceCapabilities.capability, filters.capability));
    if (capable.length === 0) {
      return [];
    }
    conditions.push(
      inArray(
        devices.id,
        capable.map((c) => c.deviceId),
      ),
    );
  }

  const deviceRows =
    conditions.length === 0
      ? await db.select().from(devices)
      : await db
          .select()
          .from(devices)
          .where(and(...conditions));

  const bundle = await loadDeviceBundle(db, deviceRows);
  return deviceRows.map((d) =>
    toRecord(d, bundle.roomsById, bundle.capsByDevice, bundle.tagsByDevice, controller),
  );
}

/** Fetch one device or throw not_found. */
export async function getDevice(
  db: Db,
  controller: MatterController,
  id: string,
): Promise<DeviceRecord> {
  const deviceRows = await db.select().from(devices).where(eq(devices.id, id));
  const device = deviceRows[0];
  if (!device) {
    throw new GharError(404, "not_found", "device not found");
  }
  const bundle = await loadDeviceBundle(db, [device]);
  return toRecord(device, bundle.roomsById, bundle.capsByDevice, bundle.tagsByDevice, controller);
}

/** Capability names present on a device. */
export async function deviceCapabilitySet(db: Db, deviceId: string): Promise<Set<string>> {
  const rows = await db
    .select({ capability: deviceCapabilities.capability })
    .from(deviceCapabilities)
    .where(eq(deviceCapabilities.deviceId, deviceId));
  return new Set(rows.map((r) => r.capability));
}

/** True when a unique-violation style postgres error mentions the given constraint fragment. */
export function isUniqueViolation(err: unknown, fragment?: string): boolean {
  const message = err instanceof Error ? `${err.message} ${err.cause instanceof Error ? err.cause.message : ""}` : "";
  if (!/unique|duplicate/i.test(message)) {
    return false;
  }
  if (fragment && !message.includes(fragment)) {
    return false;
  }
  return true;
}

/** Count devices still referencing a room (for delete guard). */
export async function countDevicesInRoom(db: Db, roomId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(devices)
    .where(eq(devices.roomId, roomId));
  return rows[0]?.count ?? 0;
}

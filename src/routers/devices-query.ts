/** Load devices with tags and capabilities for API responses. */

import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  deviceCapabilities,
  devices,
  deviceTags,
  tags,
  type DeviceCapabilityRow,
  type DeviceRow,
  type TagRow,
} from "../db/schema.js";
import { GharError } from "../errors.js";
import type { MatterController } from "../matter/controller-api.js";
import { toDeviceRecord } from "../serialize.js";
import type { DeviceRecord } from "../types/domain.js";

export type DeviceFilters = {
  tag?: string | undefined;
  capability?: DeviceCapabilityRow["capability"] | undefined;
  kind?: DeviceRow["kind"] | undefined;
};

async function loadDeviceBundle(
  db: Db,
  deviceRows: DeviceRow[],
): Promise<{
  capsByDevice: Map<string, DeviceCapabilityRow[]>;
  tagsByDevice: Map<string, TagRow[]>;
}> {
  const capsByDevice = new Map<string, DeviceCapabilityRow[]>();
  const tagsByDevice = new Map<string, TagRow[]>();
  if (deviceRows.length === 0) {
    return { capsByDevice, tagsByDevice };
  }

  const deviceIds = deviceRows.map((d) => d.id);

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

  return { capsByDevice, tagsByDevice };
}

function toRecord(
  device: DeviceRow,
  capsByDevice: Map<string, DeviceCapabilityRow[]>,
  tagsByDevice: Map<string, TagRow[]>,
  controller: MatterController,
): DeviceRecord {
  return toDeviceRecord({
    id: device.id,
    nodeId: device.nodeId,
    endpoint: device.endpoint,
    name: device.name,
    kind: device.kind,
    deviceTypes: device.deviceTypes,
    bridgeName: device.bridgeName,
    online: device.online,
    lastSeenAt: device.lastSeenAt,
    vendorName: device.vendorName,
    productName: device.productName,
    tags: tagsByDevice.get(device.id) ?? [],
    capabilities: (capsByDevice.get(device.id) ?? []).map((c) => ({
      capability: c.capability,
      config: c.config,
    })),
    state: controller.getState(device.id),
  });
}

/** List devices with optional tag/capability/kind filters. Unknown filters → empty list. */
export async function listDevices(
  db: Db,
  controller: MatterController,
  filters: DeviceFilters,
): Promise<DeviceRecord[]> {
  const conditions = [];

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

  if (filters.kind !== undefined) {
    conditions.push(eq(devices.kind, filters.kind));
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
    toRecord(d, bundle.capsByDevice, bundle.tagsByDevice, controller),
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
  return toRecord(device, bundle.capsByDevice, bundle.tagsByDevice, controller);
}

/**
 * The config of one capability on a device, or `capability_unsupported` when the device
 * does not have it.
 */
export async function deviceCapabilityConfig(
  db: Db,
  deviceId: string,
  capability: DeviceCapabilityRow["capability"],
): Promise<Record<string, unknown>> {
  const rows = await db
    .select({ config: deviceCapabilities.config })
    .from(deviceCapabilities)
    .where(and(eq(deviceCapabilities.deviceId, deviceId), eq(deviceCapabilities.capability, capability)));
  const row = rows[0];
  if (!row) {
    throw new GharError(422, "capability_unsupported", `device does not support capability ${capability}`);
  }
  return row.config;
}

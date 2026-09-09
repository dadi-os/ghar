/** Persist commissioned endpoints into the Postgres registry. */

import { and, eq } from "drizzle-orm";
import type { ClientNode } from "@matter/main";
import { BasicInformationClient } from "@matter/main/behaviors/basic-information";
import { ColorControlClient } from "@matter/main/behaviors/color-control";
import { DescriptorClient } from "@matter/main/behaviors/descriptor";
import type { Db } from "../db/client.js";
import { deviceCapabilities, devices, rooms } from "../db/schema.js";
import { deriveCapabilities, type CapabilityRecord } from "./capabilities.js";
import type { Logger } from "../logging.js";

export type RegisteredDevice = {
  id: string;
  nodeId: bigint;
  endpoint: number;
  capabilities: CapabilityRecord[];
};

async function unassignedRoomId(db: Db): Promise<string> {
  const rows = await db.select().from(rooms).where(eq(rooms.name, "unassigned"));
  const row = rows[0];
  if (!row) {
    throw new Error('seed room "unassigned" is missing; run db:migrate');
  }
  return row.id;
}

function colorFeaturesFromEndpoint(endpoint: {
  maybeFeaturesOf: (t: typeof ColorControlClient) => { hueSaturation?: boolean; colorTemperature?: boolean } | undefined;
}): { hueSaturation?: boolean; colorTemperature?: boolean } | undefined {
  const features = endpoint.maybeFeaturesOf(ColorControlClient);
  if (!features) {
    return undefined;
  }
  return {
    hueSaturation: features.hueSaturation === true,
    colorTemperature: features.colorTemperature === true,
  };
}

/**
 * Upsert one Postgres row per controllable endpoint on a commissioned peer.
 * Endpoints with no Ghar capabilities are skipped.
 */
export async function syncNodeToRegistry(
  db: Db,
  node: ClientNode,
  log: Logger,
): Promise<RegisteredDevice[]> {
  const peerAddress = node.peerAddress;
  if (!peerAddress) {
    throw new Error("cannot sync uncommissioned node");
  }
  const nodeId = BigInt(peerAddress.nodeId);
  const basic = node.maybeStateOf(BasicInformationClient);
  const vendorName = basic?.vendorName ?? null;
  const productName = basic?.productName ?? null;
  const roomId = await unassignedRoomId(db);
  const registered: RegisteredDevice[] = [];

  for (const endpoint of node.parts) {
    const endpointNumber = endpoint.number;
    if (endpointNumber === undefined || endpointNumber === 0) {
      continue;
    }
    const descriptor = endpoint.maybeStateOf(DescriptorClient);
    const serverList = (descriptor?.serverList ?? []).map((id) => Number(id));
    const colorFeatures = colorFeaturesFromEndpoint(endpoint);
    const capabilities = deriveCapabilities({
      endpoint: endpointNumber,
      serverList,
      ...(colorFeatures ? { colorFeatures } : {}),
    });
    if (capabilities.length === 0) {
      continue;
    }

    const name =
      productName && productName.length > 0
        ? `${productName} (${endpointNumber})`
        : `device-${nodeId}-${endpointNumber}`;

    const existing = await db
      .select()
      .from(devices)
      .where(and(eq(devices.nodeId, nodeId), eq(devices.endpoint, endpointNumber)));

    let deviceId: string;
    if (existing[0]) {
      deviceId = existing[0].id;
      await db
        .update(devices)
        .set({
          name,
          vendorName,
          productName,
          online: true,
          lastSeenAt: new Date(),
        })
        .where(eq(devices.id, deviceId));
      await db.delete(deviceCapabilities).where(eq(deviceCapabilities.deviceId, deviceId));
    } else {
      const inserted = await db
        .insert(devices)
        .values({
          nodeId,
          endpoint: endpointNumber,
          name,
          roomId,
          online: true,
          lastSeenAt: new Date(),
          vendorName,
          productName,
        })
        .returning({ id: devices.id });
      const row = inserted[0];
      if (!row) {
        throw new Error("device insert returned no row");
      }
      deviceId = row.id;
    }

    if (capabilities.length > 0) {
      await db.insert(deviceCapabilities).values(
        capabilities.map((cap) => ({
          deviceId,
          capability: cap.capability,
          config: cap.config,
        })),
      );
    }

    registered.push({ id: deviceId, nodeId, endpoint: endpointNumber, capabilities });
    log.info("device registered", {
      device_id: deviceId,
      node_id: nodeId.toString(),
      endpoint: endpointNumber,
      capabilities: capabilities.map((c) => c.capability),
      vendor: vendorName,
      product: productName,
    });
  }

  return registered;
}

/** Persist commissioned endpoints into the Postgres registry. */

import { and, eq } from "drizzle-orm";
import type { ClientNode, Endpoint } from "@matter/main";
import { BasicInformationClient } from "@matter/main/behaviors/basic-information";
import { BridgedDeviceBasicInformationClient } from "@matter/main/behaviors/bridged-device-basic-information";
import { ColorControlClient } from "@matter/main/behaviors/color-control";
import { DescriptorClient } from "@matter/main/behaviors/descriptor";
import { FixedLabelClient } from "@matter/main/behaviors/fixed-label";
import { UserLabelClient } from "@matter/main/behaviors/user-label";
import type { Db } from "../db/client.js";
import { deviceCapabilities, devices, rooms } from "../db/schema.js";
import { deriveCapabilities, type CapabilityRecord } from "./capabilities.js";
import type { Logger } from "../logging.js";
import { withTimeout } from "./timeout.js";

/** Budget for one nodeLabel or label-list read during sync. */
const LABEL_READ_MS = 2_000;

type LabelList = ReadonlyArray<{ label: string; value: string }> | undefined;

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
 * A label the device chose for itself, when it is not just the model string.
 * Empty and product-identical labels are discarded.
 */
export function distinctDeviceLabel(
  raw: string | null | undefined,
  productName: string | null,
): string | null {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) {
    return null;
  }
  const product = productName?.trim() ?? "";
  if (product && trimmed.localeCompare(product, undefined, { sensitivity: "accent" }) === 0) {
    return null;
  }
  return trimmed;
}

/**
 * Name for a new endpoint.
 * Prefers the endpoint or node label. The endpoint number is appended only
 * when several endpoints on the node would otherwise share that name.
 */
export function endpointDisplayName(input: {
  endpointLabel: string | null;
  nodeLabel: string | null;
  productName: string | null;
  endpoint: number;
  peersSharingLabel: number;
}): string {
  const base =
    input.endpointLabel ?? input.nodeLabel ?? (input.productName?.trim() || "Device");
  if (input.peersSharingLabel > 1) {
    return `${base} (${input.endpoint})`;
  }
  return base;
}

/** First user-label value that names the endpoint, ignoring place and meta tags. */
function userLabelName(
  list: ReadonlyArray<{ label: string; value: string }> | undefined,
  productName: string | null,
): string | null {
  if (!list) {
    return null;
  }
  const named = list.find((entry) => /^(name|label|device)$/i.test(entry.label.trim()));
  const fromKey = distinctDeviceLabel(named?.value, productName);
  if (fromKey) {
    return fromKey;
  }
  for (const entry of list) {
    if (
      /^(room|zone|area|floor|location|orientation|serial|mac|uuid|id|firmware|version|model|sku|part|pn)$/i.test(
        entry.label.trim(),
      )
    ) {
      continue;
    }
    const value = distinctDeviceLabel(entry.value, productName);
    if (value) {
      return value;
    }
  }
  return null;
}

/**
 * True when `name` is still the registry's generated label, not a rename.
 * Stock names are replaced on later syncs when Matter has a real node label.
 */
export function isStockDeviceName(name: string, productName: string | null): boolean {
  const trimmed = name.trim();
  if (!trimmed || trimmed === "Device") {
    return true;
  }
  if (/^device-\d+-\d+$/i.test(trimmed)) {
    return true;
  }
  const product = productName?.trim() ?? "";
  if (!product) {
    return false;
  }
  if (trimmed.localeCompare(product, undefined, { sensitivity: "accent" }) === 0) {
    return true;
  }
  const escaped = product.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped} \\(\\d+\\)$`, "i").test(trimmed);
}

/**
 * Fresh attribute read. Returns undefined when the read fails; the caller
 * keeps the subscription cache. The failure is logged.
 */
async function readFresh<T>(
  read: () => Promise<T>,
  log: Logger,
  label: string,
): Promise<T | undefined> {
  try {
    return await withTimeout(read(), LABEL_READ_MS, label);
  } catch (err) {
    log.warn("matter label read failed", {
      label,
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

function asLabelList(value: unknown): LabelList {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const list: Array<{ label: string; value: string }> = [];
  for (const entry of value) {
    if (
      entry !== null &&
      typeof entry === "object" &&
      "label" in entry &&
      "value" in entry &&
      typeof entry.label === "string" &&
      typeof entry.value === "string"
    ) {
      list.push({ label: entry.label, value: entry.value });
    }
  }
  return list;
}

/** Live names. A user or fixed label wins, then nodeLabel, then productLabel. */
async function readNodeNames(
  node: ClientNode,
  log: Logger,
): Promise<{ vendorName: string | null; productName: string | null; nodeLabel: string | null }> {
  const cachedBasic = node.maybeStateOf(BasicInformationClient);
  const fresh =
    (await readFresh(
      () =>
        node.getStateOf(BasicInformationClient, [
          "vendorName",
          "productName",
          "productLabel",
          "nodeLabel",
        ]),
      log,
      "basic-information",
    )) ?? cachedBasic;
  const productName = fresh?.productName ?? null;
  const cachedUser = node.maybeStateOf(UserLabelClient);
  const user = node.behaviors.has(UserLabelClient)
    ? ((await readFresh(
        () => node.getStateOf(UserLabelClient, ["labelList"]),
        log,
        "user-label",
      )) ?? cachedUser)
    : cachedUser;
  const cachedFixed = node.maybeStateOf(FixedLabelClient);
  const fixed = node.behaviors.has(FixedLabelClient)
    ? ((await readFresh(
        () => node.getStateOf(FixedLabelClient, ["labelList"]),
        log,
        "fixed-label",
      )) ?? cachedFixed)
    : cachedFixed;
  const nodeLabel =
    userLabelName(asLabelList(user?.labelList), productName) ??
    userLabelName(asLabelList(fixed?.labelList), productName) ??
    distinctDeviceLabel(fresh?.nodeLabel, productName) ??
    distinctDeviceLabel(fresh?.productLabel, productName);
  log.info("matter node labels", {
    node_label: fresh?.nodeLabel ?? null,
    product_label: fresh?.productLabel ?? null,
    product: productName,
    chosen: nodeLabel,
  });
  return {
    vendorName: fresh?.vendorName ?? null,
    productName,
    nodeLabel,
  };
}

/** Live endpoint label from the bridge cluster, then user and fixed labels. */
async function readEndpointLabel(
  endpoint: Endpoint,
  productName: string | null,
  log: Logger,
  endpointNumber: number,
): Promise<string | null> {
  const cachedBridged = endpoint.maybeStateOf(BridgedDeviceBasicInformationClient);
  const bridged = endpoint.behaviors.has(BridgedDeviceBasicInformationClient)
    ? ((await readFresh(
        () =>
          endpoint.getStateOf(BridgedDeviceBasicInformationClient, ["nodeLabel", "productLabel"]),
        log,
        `bridged-basic-${endpointNumber}`,
      )) ?? cachedBridged)
    : cachedBridged;
  const cachedUser = endpoint.maybeStateOf(UserLabelClient);
  const user = endpoint.behaviors.has(UserLabelClient)
    ? ((await readFresh(
        () => endpoint.getStateOf(UserLabelClient, ["labelList"]),
        log,
        `user-label-${endpointNumber}`,
      )) ?? cachedUser)
    : cachedUser;
  const cachedFixed = endpoint.maybeStateOf(FixedLabelClient);
  const fixed = endpoint.behaviors.has(FixedLabelClient)
    ? ((await readFresh(
        () => endpoint.getStateOf(FixedLabelClient, ["labelList"]),
        log,
        `fixed-label-${endpointNumber}`,
      )) ?? cachedFixed)
    : cachedFixed;
  return (
    userLabelName(asLabelList(user?.labelList), productName) ??
    userLabelName(asLabelList(fixed?.labelList), productName) ??
    distinctDeviceLabel(bridged?.nodeLabel, productName) ??
    distinctDeviceLabel(bridged?.productLabel, productName)
  );
}

/**
 * Upsert one Postgres row per controllable endpoint on a commissioned peer.
 * Endpoints with no Ghar capabilities are skipped.
 *
 * `placeRoomId`, when set, is the room for new rows and for endpoints already
 * in the registry. Reconnect sync omits it so an existing room stays put.
 * An existing row keeps a rename. A stock product label is replaced when
 * Matter now has a node or user label.
 */
export async function syncNodeToRegistry(
  db: Db,
  node: ClientNode,
  log: Logger,
  placeRoomId?: string,
): Promise<RegisteredDevice[]> {
  const peerAddress = node.peerAddress;
  if (!peerAddress) {
    throw new Error("cannot sync uncommissioned node");
  }
  const nodeId = BigInt(peerAddress.nodeId);
  const names = await readNodeNames(node, log);
  const vendorName = names.vendorName;
  const productName = names.productName;
  const nodeLabel = names.nodeLabel;
  const roomId = placeRoomId ?? (await unassignedRoomId(db));
  const registered: RegisteredDevice[] = [];

  type PendingEndpoint = {
    endpointNumber: number;
    capabilities: CapabilityRecord[];
    endpointLabel: string | null;
  };
  const pending: PendingEndpoint[] = [];

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

    const endpointLabel = await readEndpointLabel(endpoint, productName, log, endpointNumber);
    pending.push({ endpointNumber, capabilities, endpointLabel });
  }

  const sharing = new Map<string, number>();
  for (const item of pending) {
    const base = item.endpointLabel ?? nodeLabel ?? (productName?.trim() || "Device");
    sharing.set(base, (sharing.get(base) ?? 0) + 1);
  }

  for (const item of pending) {
    const { endpointNumber, capabilities } = item;
    const base = item.endpointLabel ?? nodeLabel ?? (productName?.trim() || "Device");
    const peers = sharing.get(base);
    if (peers === undefined) {
      throw new Error(`endpoint label was not counted: ${base}`);
    }
    const name = endpointDisplayName({
      endpointLabel: item.endpointLabel,
      nodeLabel,
      productName,
      endpoint: endpointNumber,
      peersSharingLabel: peers,
    });

    const existing = await db
      .select()
      .from(devices)
      .where(and(eq(devices.nodeId, nodeId), eq(devices.endpoint, endpointNumber)));

    let deviceId: string;
    if (existing[0]) {
      deviceId = existing[0].id;
      const stock = isStockDeviceName(existing[0].name, existing[0].productName ?? productName);
      await db
        .update(devices)
        .set({
          vendorName,
          productName,
          online: true,
          lastSeenAt: new Date(),
          ...(stock ? { name } : {}),
          ...(placeRoomId !== undefined ? { roomId: placeRoomId } : {}),
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

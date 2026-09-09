/** Convert camelCase DB / cache shapes to snake_case API records. */

import type { CommissionJob } from "./matter/commissioning.js";
import type { CachedAttribute } from "./matter/state-cache.js";
import type {
  AttributeState,
  CapabilityRecord,
  CommissionJobRecord,
  DeviceRecord,
  EventRecord,
  RoomRecord,
  TagRecord,
} from "./types/domain.js";

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export function toAttributeState(attr: CachedAttribute): AttributeState {
  return {
    value: attr.value,
    changed_at: attr.changedAt.toISOString(),
  };
}

export function toStateMap(
  attrs: ReadonlyMap<string, CachedAttribute> | undefined,
): Record<string, AttributeState> {
  if (!attrs) {
    return {};
  }
  const out: Record<string, AttributeState> = {};
  for (const [key, value] of attrs) {
    out[key] = toAttributeState(value);
  }
  return out;
}

export function toRoomRecord(row: { id: string; name: string }): RoomRecord {
  return { id: row.id, name: row.name };
}

export function toTagRecord(row: { id: string; name: string; deviceCount: number }): TagRecord {
  return { id: row.id, name: row.name, device_count: row.deviceCount };
}

export function toCapabilityRecord(row: {
  capability: CapabilityRecord["capability"];
  config: Record<string, unknown>;
}): CapabilityRecord {
  return { capability: row.capability, config: row.config };
}

export function toDeviceRecord(args: {
  id: string;
  nodeId: bigint;
  endpoint: number;
  name: string;
  online: boolean;
  lastSeenAt: Date | null;
  vendorName: string | null;
  productName: string | null;
  room: { id: string; name: string };
  tags: Array<{ id: string; name: string }>;
  capabilities: Array<{ capability: CapabilityRecord["capability"]; config: Record<string, unknown> }>;
  state: ReadonlyMap<string, CachedAttribute> | undefined;
}): DeviceRecord {
  return {
    id: args.id,
    node_id: args.nodeId.toString(),
    endpoint: args.endpoint,
    name: args.name,
    room: toRoomRecord(args.room),
    tags: args.tags.map((t) => ({ id: t.id, name: t.name })),
    capabilities: args.capabilities.map(toCapabilityRecord),
    online: args.online,
    last_seen_at: iso(args.lastSeenAt),
    vendor_name: args.vendorName,
    product_name: args.productName,
    state: toStateMap(args.state),
  };
}

export function toEventRecord(row: {
  id: bigint;
  deviceId: string;
  attributeKey: string;
  oldValue: unknown;
  newValue: unknown;
  cause: EventRecord["cause"];
  causeRef: string | null;
  createdAt: Date;
}): EventRecord {
  return {
    id: row.id.toString(),
    device_id: row.deviceId,
    attribute_key: row.attributeKey,
    old_value: row.oldValue,
    new_value: row.newValue,
    cause: row.cause,
    cause_ref: row.causeRef,
    created_at: row.createdAt.toISOString(),
  };
}

export function toCommissionJobRecord(job: CommissionJob): CommissionJobRecord {
  return {
    id: job.id,
    status: job.status,
    node_id: job.nodeId ?? null,
    device_ids: job.deviceIds ?? null,
    error: job.error ?? null,
    started_at: job.startedAt.toISOString(),
    finished_at: job.finishedAt ? job.finishedAt.toISOString() : null,
  };
}

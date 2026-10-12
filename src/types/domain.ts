/** Agent/widget-facing record shapes (snake_case). */

import type { GharCapability } from "../matter/capabilities.js";
import type { EventCause } from "../matter/cause.js";
import type { CommissionStatus } from "../matter/commissioning.js";

export type CapabilityRecord = {
  capability: GharCapability;
  config: Record<string, unknown>;
};

export type AttributeState = {
  value: unknown;
  changed_at: string;
};

export type DeviceRecord = {
  id: string;
  node_id: string;
  endpoint: number;
  name: string;
  room: { id: string; name: string };
  tags: Array<{ id: string; name: string }>;
  capabilities: CapabilityRecord[];
  online: boolean;
  last_seen_at: string | null;
  vendor_name: string | null;
  product_name: string | null;
  state: Record<string, AttributeState>;
};

export type RoomRecord = {
  id: string;
  name: string;
};

export type TagRecord = {
  id: string;
  name: string;
  device_count: number;
};

export type EventRecord = {
  id: string;
  device_id: string;
  attribute_key: string;
  old_value: unknown;
  new_value: unknown;
  cause: EventCause;
  cause_ref: string | null;
  created_at: string;
};

export type CommissionJobRecord = {
  id: string;
  status: CommissionStatus;
  node_id: string | null;
  device_ids: string[] | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

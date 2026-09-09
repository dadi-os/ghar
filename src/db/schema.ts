/** Drizzle table definitions for rooms, devices, capabilities, tags, and event logs. */

import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const deviceCapabilityEnum = pgEnum("device_capability", [
  "switchable",
  "dimmable",
  "colorable",
  "sensor",
  "lockable",
  "media",
  "thermostat",
]);

export const eventCauseEnum = pgEnum("event_cause", ["agent", "user", "external"]);

export const rooms = pgTable(
  "rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
  },
  (table) => [uniqueIndex("rooms_name_idx").on(table.name)],
);

/**
 * One row per controllable Matter endpoint. A single node may expose several
 * endpoints (e.g. a multi-outlet strip); the unique key is (node_id, endpoint).
 */
export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nodeId: bigint("node_id", { mode: "bigint" }).notNull(),
    endpoint: integer("endpoint").notNull(),
    name: text("name").notNull(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "restrict" }),
    online: boolean("online").notNull().default(false),
    lastSeenAt: timestamptz("last_seen_at"),
    vendorName: text("vendor_name"),
    productName: text("product_name"),
  },
  (table) => [uniqueIndex("devices_node_id_endpoint_idx").on(table.nodeId, table.endpoint)],
);

export const deviceCapabilities = pgTable(
  "device_capabilities",
  {
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    capability: deviceCapabilityEnum("capability").notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [primaryKey({ columns: [table.deviceId, table.capability] })],
);

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
  },
  (table) => [uniqueIndex("tags_name_idx").on(table.name)],
);

export const deviceTags = pgTable(
  "device_tags",
  {
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.deviceId, table.tagId] })],
);

/** Observed device state changes; id is the resumption cursor. */
export const eventLogs = pgTable(
  "event_logs",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    attributeKey: text("attribute_key").notNull(),
    oldValue: jsonb("old_value").$type<unknown>(),
    newValue: jsonb("new_value").$type<unknown>(),
    cause: eventCauseEnum("cause").notNull(),
    causeRef: text("cause_ref"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("event_logs_created_at_idx").on(table.createdAt),
    index("event_logs_device_id_created_at_idx").on(table.deviceId, table.createdAt),
  ],
);

export type RoomRow = typeof rooms.$inferSelect;
export type DeviceRow = typeof devices.$inferSelect;
export type DeviceCapabilityRow = typeof deviceCapabilities.$inferSelect;
export type TagRow = typeof tags.$inferSelect;
export type DeviceTagRow = typeof deviceTags.$inferSelect;
export type EventLogRow = typeof eventLogs.$inferSelect;

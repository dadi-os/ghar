/** Historical event_logs query. Event id is the resumption cursor. */

import { and, asc, desc, eq, gt, gte, inArray, lte, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { deviceTags, devices, eventLogs, rooms, tags } from "../db/schema.js";
import { GharError } from "../errors.js";
import { toEventRecord } from "../serialize.js";
import { asStringList, eventsQuery, parse } from "./schemas.js";

function parseSince(since: string): { kind: "id"; id: bigint } | { kind: "time"; at: Date } {
  if (/^\d+$/.test(since)) {
    return { kind: "id", id: BigInt(since) };
  }
  const at = new Date(since);
  if (Number.isNaN(at.getTime())) {
    throw new GharError(422, "invalid_request", "since must be an event id or ISO timestamp");
  }
  return { kind: "time", at };
}

export async function registerEvents(app: FastifyInstance): Promise<void> {
  app.get("/events", async (request) => {
    const query = parse(eventsQuery, request.query);
    if (query.limit !== undefined && query.limit > app.config.page.max_size) {
      throw new GharError(
        422,
        "invalid_request",
        `limit exceeds maximum of ${app.config.page.max_size}`,
      );
    }
    const limit = query.limit ?? app.config.page.default_size;
    const order = query.order ?? "asc";
    const conditions: SQL[] = [];

    const deviceIds = asStringList(query.device_id);
    let scopedIds: string[] | undefined = deviceIds;

    if (query.room !== undefined) {
      const roomRows = await app.db.select().from(rooms).where(eq(rooms.name, query.room));
      const room = roomRows[0];
      if (!room) {
        return { events: [] };
      }
      const inRoom = await app.db
        .select({ id: devices.id })
        .from(devices)
        .where(eq(devices.roomId, room.id));
      const roomIds = inRoom.map((r) => r.id);
      scopedIds = scopedIds ? scopedIds.filter((id) => roomIds.includes(id)) : roomIds;
      if (scopedIds.length === 0) {
        return { events: [] };
      }
    }

    if (query.tag !== undefined) {
      const tagRows = await app.db.select().from(tags).where(eq(tags.name, query.tag));
      const tag = tagRows[0];
      if (!tag) {
        return { events: [] };
      }
      const tagged = await app.db
        .select({ deviceId: deviceTags.deviceId })
        .from(deviceTags)
        .where(eq(deviceTags.tagId, tag.id));
      const tagIds = tagged.map((t) => t.deviceId);
      scopedIds = scopedIds ? scopedIds.filter((id) => tagIds.includes(id)) : tagIds;
      if (scopedIds.length === 0) {
        return { events: [] };
      }
    }

    if (scopedIds !== undefined) {
      conditions.push(inArray(eventLogs.deviceId, scopedIds));
    }

    if (query.key !== undefined) {
      conditions.push(eq(eventLogs.attributeKey, query.key));
    }

    if (query.cause !== undefined) {
      conditions.push(eq(eventLogs.cause, query.cause));
    }

    if (query.since !== undefined) {
      const since = parseSince(query.since);
      if (since.kind === "id") {
        conditions.push(gt(eventLogs.id, since.id));
      } else {
        conditions.push(gte(eventLogs.createdAt, since.at));
      }
    }

    if (query.until !== undefined) {
      conditions.push(lte(eventLogs.createdAt, new Date(query.until)));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const rows = await app.db
      .select()
      .from(eventLogs)
      .where(where)
      .orderBy(order === "desc" ? desc(eventLogs.id) : asc(eventLogs.id))
      .limit(limit);

    return { events: rows.map(toEventRecord) };
  });
}

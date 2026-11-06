/** Tag routes: a tag is a named set of devices, and a device can carry any number of tags. */

import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { deviceTags, tags } from "../db/schema.js";
import { addDeviceTags, deleteOrphanTags, isUniqueViolation, requireDevices } from "../db/tags.js";
import { GharError } from "../errors.js";
import { toTagRecord } from "../serialize.js";
import type { TagRecord } from "../types/domain.js";
import {
  createTagBody,
  idParam,
  parse,
  patchTagBody,
  tagDeviceParams,
  tagDevicesBody,
} from "./schemas.js";

function selectTags(app: FastifyInstance) {
  return app.db
    .select({
      id: tags.id,
      name: tags.name,
      deviceCount: sql<number>`(
        SELECT count(*)::int FROM device_tags WHERE device_tags.tag_id = ${tags.id}
      )`,
    })
    .from(tags);
}

async function tagRecord(app: FastifyInstance, id: string): Promise<TagRecord> {
  const rows = await selectTags(app).where(eq(tags.id, id));
  const row = rows[0];
  if (!row) {
    throw new GharError(404, "not_found", "tag not found");
  }
  return toTagRecord(row);
}

export async function registerTags(app: FastifyInstance): Promise<void> {
  app.get("/tags", async () => {
    return { tags: (await selectTags(app)).map(toTagRecord) };
  });

  app.post("/tags", async (request, reply) => {
    const body = parse(createTagBody, request.body);
    await requireDevices(app.db, body.device_ids);
    const existing = await app.db.select().from(tags).where(eq(tags.name, body.name));
    if (existing[0]) {
      throw new GharError(409, "conflict", `tag name already exists: ${body.name}`);
    }
    for (const deviceId of body.device_ids) {
      await addDeviceTags(app.db, deviceId, [body.name]);
    }
    const created = await app.db.select().from(tags).where(eq(tags.name, body.name));
    if (!created[0]) {
      throw new GharError(500, "internal_error", "tag insert returned no row");
    }
    return reply.status(201).send(await tagRecord(app, created[0].id));
  });

  app.patch("/tags/:id", async (request) => {
    const { id } = parse(idParam, request.params);
    const body = parse(patchTagBody, request.body);
    await tagRecord(app, id);
    try {
      await app.db.update(tags).set({ name: body.name }).where(eq(tags.id, id));
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new GharError(409, "conflict", `tag name already exists: ${body.name}`);
      }
      throw err;
    }
    return tagRecord(app, id);
  });

  app.delete("/tags/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    await tagRecord(app, id);
    await app.db.delete(tags).where(eq(tags.id, id));
    return reply.status(204).send();
  });

  app.post("/tags/:id/devices", async (request) => {
    const { id } = parse(idParam, request.params);
    const body = parse(tagDevicesBody, request.body);
    const tag = await tagRecord(app, id);
    await requireDevices(app.db, body.device_ids);
    for (const deviceId of body.device_ids) {
      await app.db.insert(deviceTags).values({ deviceId, tagId: id }).onConflictDoNothing();
    }
    return tagRecord(app, tag.id);
  });

  app.delete("/tags/:id/devices/:deviceId", async (request, reply) => {
    const { id, deviceId } = parse(tagDeviceParams, request.params);
    await tagRecord(app, id);
    await app.db.execute(sql`DELETE FROM device_tags WHERE tag_id = ${id} AND device_id = ${deviceId}`);
    await deleteOrphanTags(app.db);
    return reply.status(204).send();
  });
}

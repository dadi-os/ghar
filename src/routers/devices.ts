/** Device list/detail/patch/delete and command routes. */

import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { deviceTags, devices, rooms, tags } from "../db/schema.js";
import { GharError } from "../errors.js";
import { commandSpec, type CommandIssuer } from "../matter/commands/index.js";
import { DeviceTimeoutError } from "../matter/timeout.js";
import {
  deviceCapabilityConfig,
  getDevice,
  isUniqueViolation,
  listDevices,
} from "./devices-query.js";
import {
  commandBody,
  devicesQuery,
  idParam,
  parse,
  patchDeviceBody,
} from "./schemas.js";

function issuerFromBody(body: {
  cause?: "agent" | "user" | undefined;
  cause_ref?: string | undefined;
}): CommandIssuer {
  const cause = body.cause ?? "user";
  if (body.cause_ref !== undefined) {
    return { cause, causeRef: body.cause_ref };
  }
  return { cause };
}

async function deleteOrphanTags(app: FastifyInstance): Promise<void> {
  await app.db.execute(sql`DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM device_tags)`);
}

export async function registerDevices(app: FastifyInstance): Promise<void> {
  app.get("/devices", async (request) => {
    const query = parse(devicesQuery, request.query);
    const list = await listDevices(app.db, app.controller, query);
    return { devices: list };
  });

  app.get("/devices/:id", async (request) => {
    const { id } = parse(idParam, request.params);
    return getDevice(app.db, app.controller, id);
  });

  app.patch("/devices/:id", async (request) => {
    const { id } = parse(idParam, request.params);
    const body = parse(patchDeviceBody, request.body);
    const current = await getDevice(app.db, app.controller, id);

    if (body.room !== undefined) {
      const roomRows = await app.db.select().from(rooms).where(eq(rooms.id, body.room));
      if (!roomRows[0]) {
        throw new GharError(404, "not_found", "room not found");
      }
      await app.db.update(devices).set({ roomId: body.room }).where(eq(devices.id, id));
    }

    if (body.name !== undefined) {
      await app.db.update(devices).set({ name: body.name }).where(eq(devices.id, id));
      try {
        await app.controller.setLabel(id, body.name);
      } catch (err) {
        if (err instanceof GharError && err.statusCode === 404) {
          request.log.warn(
            { device_id: id, err: err.message },
            "name saved; device has no live Matter session for nodeLabel",
          );
        } else {
          await app.db.update(devices).set({ name: current.name }).where(eq(devices.id, id));
          throw err;
        }
      }
    }

    if (body.tags !== undefined) {
      await app.db.delete(deviceTags).where(eq(deviceTags.deviceId, id));
      for (const tagName of body.tags) {
        let tagRows = await app.db.select().from(tags).where(eq(tags.name, tagName));
        let tag = tagRows[0];
        if (!tag) {
          try {
            const inserted = await app.db.insert(tags).values({ name: tagName }).returning();
            tag = inserted[0];
          } catch (err) {
            if (isUniqueViolation(err)) {
              tagRows = await app.db.select().from(tags).where(eq(tags.name, tagName));
              tag = tagRows[0];
            } else {
              throw err;
            }
          }
        }
        if (!tag) {
          throw new GharError(500, "internal_error", `failed to create tag ${tagName}`);
        }
        await app.db.insert(deviceTags).values({ deviceId: id, tagId: tag.id });
      }
      await deleteOrphanTags(app);
    }

    return getDevice(app.db, app.controller, id);
  });

  app.delete("/devices/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    await getDevice(app.db, app.controller, id);
    await app.controller.removeDevice(id);
    await deleteOrphanTags(app);
    return reply.status(204).send();
  });

  app.post("/devices/:id/command", async (request) => {
    const { id } = parse(idParam, request.params);
    const body = parse(commandBody, request.body);
    await getDevice(app.db, app.controller, id);

    const config = await deviceCapabilityConfig(app.db, id, body.capability);
    const spec = commandSpec(body.capability, body.command);
    const params = parse(spec.params, body.params ?? {});
    await app.controller.command(
      id,
      { capability: body.capability, command: body.command, params, config },
      issuerFromBody(body),
    );

    return { ok: true };
  });

  app.post("/devices/:id/identify", async (request) => {
    const { id } = parse(idParam, request.params);
    await getDevice(app.db, app.controller, id);
    try {
      await app.controller.identify(id);
    } catch (err) {
      if (err instanceof GharError) {
        throw err;
      }
      if (err instanceof DeviceTimeoutError) {
        throw new GharError(504, "device_unreachable", err.message);
      }
      throw err;
    }
    return { ok: true };
  });
}

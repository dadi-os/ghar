/** Device list/detail/patch/delete and command routes. */

import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { deviceTags, devices, rooms, tags } from "../db/schema.js";
import { GharError } from "../errors.js";
import type { CommandIssuer } from "../matter/commands.js";
import { DeviceTimeoutError } from "../matter/timeout.js";
import {
  deviceCapabilitySet,
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

    const caps = await deviceCapabilitySet(app.db, id);
    if (!caps.has(body.capability)) {
      throw new GharError(
        422,
        "capability_unsupported",
        `device does not support capability ${body.capability}`,
      );
    }

    const issuer = issuerFromBody(body);

    try {
      switch (body.capability) {
        case "switchable": {
          const state = body.params.state;
          if (state !== "on" && state !== "off" && state !== "toggle") {
            throw new GharError(422, "invalid_request", "params.state must be on, off, or toggle");
          }
          let on: boolean;
          if (state === "toggle") {
            const current = app.controller.getState(id)?.get("on")?.value;
            on = current !== true;
          } else {
            on = state === "on";
          }
          await app.controller.setOn(id, on, issuer);
          break;
        }
        case "dimmable": {
          const level = body.params.level;
          if (typeof level !== "number" || level < 0 || level > 100) {
            throw new GharError(422, "invalid_request", "params.level must be a number from 0 to 100");
          }
          await app.controller.setBrightness(id, level, issuer);
          break;
        }
        case "colorable": {
          const colorTemp = body.params.color_temp;
          const hue = body.params.hue;
          const saturation = body.params.saturation;
          if (typeof colorTemp === "number") {
            await app.controller.setColor(id, { colorTempMireds: colorTemp }, issuer);
          } else if (typeof hue === "number" && typeof saturation === "number") {
            await app.controller.setColor(id, { hue, saturation }, issuer);
          } else {
            throw new GharError(
              422,
              "invalid_request",
              "params must include color_temp or both hue and saturation",
            );
          }
          break;
        }
        default:
          throw new GharError(
            422,
            "capability_unsupported",
            `command dispatch for ${body.capability} is not implemented`,
          );
      }
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

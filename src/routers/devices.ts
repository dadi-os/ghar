/** Device list/detail/patch/delete and command routes. */

import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import type { Db } from "../db/client.js";
import { deviceTags, devices } from "../db/schema.js";
import { addDeviceTags, deleteOrphanTags } from "../db/tags.js";
import { GharError } from "../errors.js";
import { commandSpec, type CommandIssuer } from "../matter/commands/index.js";
import type { MatterController } from "../matter/controller-api.js";
import { DeviceTimeoutError } from "../matter/timeout.js";
import {
  deviceCapabilityConfig,
  getDevice,
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

/**
 * issueDeviceCommand sends one capability command to a device and waits for it. A device
 * that does not answer is a 504 `device_unreachable`; a capability the device lacks is a 422.
 */
export async function issueDeviceCommand(
  deps: { db: Db; controller: MatterController },
  id: string,
  body: Pick<z.infer<typeof commandBody>, "capability" | "command" | "params">,
  issuer: CommandIssuer,
): Promise<void> {
  await getDevice(deps.db, deps.controller, id);
  const config = await deviceCapabilityConfig(deps.db, id, body.capability);
  const spec = commandSpec(body.capability, body.command);
  const params = parse(spec.params, body.params ?? {});
  try {
    await deps.controller.command(id, { capability: body.capability, command: body.command, params, config }, issuer);
  } catch (err) {
    if (err instanceof DeviceTimeoutError) {
      throw new GharError(504, "device_unreachable", err.message);
    }
    throw err;
  }
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
      await addDeviceTags(app.db, id, body.tags);
      await deleteOrphanTags(app.db);
    }

    return getDevice(app.db, app.controller, id);
  });

  app.delete("/devices/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    await getDevice(app.db, app.controller, id);
    await app.controller.removeDevice(id);
    await deleteOrphanTags(app.db);
    return reply.status(204).send();
  });

  app.post("/devices/:id/command", async (request) => {
    const { id } = parse(idParam, request.params);
    const body = parse(commandBody, request.body);
    await issueDeviceCommand(app, id, body, issuerFromBody(body));
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

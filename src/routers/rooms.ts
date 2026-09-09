/** Room CRUD routes. The seeded `unassigned` room is protected. */

import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { UNASSIGNED_ROOM } from "../constants.js";
import { rooms } from "../db/schema.js";
import { GharError } from "../errors.js";
import { toRoomRecord } from "../serialize.js";
import { countDevicesInRoom, isUniqueViolation } from "./devices-query.js";
import { createRoomBody, idParam, parse, patchRoomBody } from "./schemas.js";

export async function registerRooms(app: FastifyInstance): Promise<void> {
  app.get("/rooms", async () => {
    const rows = await app.db.select().from(rooms);
    return { rooms: rows.map(toRoomRecord) };
  });

  app.post("/rooms", async (request, reply) => {
    const body = parse(createRoomBody, request.body);
    try {
      const inserted = await app.db.insert(rooms).values({ name: body.name }).returning();
      const row = inserted[0];
      if (!row) {
        throw new GharError(500, "internal_error", "room insert returned no row");
      }
      return reply.status(201).send(toRoomRecord(row));
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new GharError(409, "conflict", `room name already exists: ${body.name}`);
      }
      throw err;
    }
  });

  app.patch("/rooms/:id", async (request) => {
    const { id } = parse(idParam, request.params);
    const body = parse(patchRoomBody, request.body);
    const existing = await app.db.select().from(rooms).where(eq(rooms.id, id));
    const row = existing[0];
    if (!row) {
      throw new GharError(404, "not_found", "room not found");
    }
    if (row.name === UNASSIGNED_ROOM) {
      throw new GharError(409, "conflict", "the unassigned room cannot be renamed");
    }
    try {
      const updated = await app.db
        .update(rooms)
        .set({ name: body.name })
        .where(eq(rooms.id, id))
        .returning();
      const next = updated[0];
      if (!next) {
        throw new GharError(500, "internal_error", "room update returned no row");
      }
      return toRoomRecord(next);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new GharError(409, "conflict", `room name already exists: ${body.name}`);
      }
      throw err;
    }
  });

  app.delete("/rooms/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const existing = await app.db.select().from(rooms).where(eq(rooms.id, id));
    const row = existing[0];
    if (!row) {
      throw new GharError(404, "not_found", "room not found");
    }
    if (row.name === UNASSIGNED_ROOM) {
      throw new GharError(409, "conflict", "the unassigned room cannot be deleted");
    }
    const count = await countDevicesInRoom(app.db, id);
    if (count > 0) {
      throw new GharError(409, "conflict", "room still has devices");
    }
    await app.db.delete(rooms).where(eq(rooms.id, id));
    return reply.status(204).send();
  });
}

/**
 * Async commissioning job routes. Failed jobs still return HTTP 200 so
 * pollers can read the reason from the job payload.
 */

import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { rooms } from "../db/schema.js";
import { GharError } from "../errors.js";
import { toCommissionJobRecord } from "../serialize.js";
import { commissionBody, jobIdParam, parse } from "./schemas.js";

export async function registerCommission(app: FastifyInstance): Promise<void> {
  app.post("/commission", async (request, reply) => {
    const body = parse(commissionBody, request.body);
    const radio = body.radio ?? "network";
    if (body.room_id !== undefined) {
      const roomRows = await app.db.select().from(rooms).where(eq(rooms.id, body.room_id));
      if (!roomRows[0]) {
        throw new GharError(404, "not_found", "room not found");
      }
    }
    if (radio === "nearby" && !app.controller.radioAttached()) {
      throw new GharError(422, "radio_unavailable", "no hath radio is attached");
    }
    try {
      const job = app.controller.startCommission({
        code: body.code,
        radio,
        ...(body.room_id !== undefined ? { roomId: body.room_id } : {}),
        ...(body.wifi !== undefined ? { wifi: body.wifi } : {}),
      });
      return reply.status(202).send({ job_id: job.id });
    } catch (err) {
      if (err instanceof GharError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      if (/already|duplicate|exists|conflict/i.test(message)) {
        throw new GharError(409, "conflict", message);
      }
      throw new GharError(422, "commissioning_failed", message);
    }
  });

  app.get("/commission/:jobId", async (request) => {
    const { jobId } = parse(jobIdParam, request.params);
    const job = app.controller.getCommissionJob(jobId);
    if (!job) {
      throw new GharError(404, "not_found", "commission job not found");
    }
    return toCommissionJobRecord(job);
  });
}

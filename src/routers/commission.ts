/**
 * Async commissioning job routes. Failed jobs still return HTTP 200 so
 * pollers can read the reason from the job payload.
 */

import type { FastifyInstance } from "fastify";
import { GharError } from "../errors.js";
import { toCommissionJobRecord } from "../serialize.js";
import { commissionBody, jobIdParam, parse } from "./schemas.js";

export async function registerCommission(app: FastifyInstance): Promise<void> {
  app.post("/commission", async (request, reply) => {
    const body = parse(commissionBody, request.body);
    try {
      const job = app.controller.startCommission(body.code);
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

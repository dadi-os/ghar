/** Plain-language device control: POST /control runs the request, GET /control/:id reads a run. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createDwarClient } from "../control/dwar.js";
import { runControl } from "../control/loop.js";
import { ControlRuns, type ControlRun } from "../control/runs.js";
import { controlTools } from "../control/tools.js";
import { idParam, parse } from "./schemas.js";

const controlBody = z
  .object({
    request: z.string().min(1),
    caller: z.string().min(1),
    wait_ms: z.number().int().min(0).max(60_000),
  })
  .strict();

/** A run as the API returns it. */
function toRecord(run: ControlRun) {
  return {
    id: run.id,
    status: run.status,
    ...(run.result !== undefined ? { result: run.result } : {}),
    ...(run.error !== undefined ? { error: run.error } : {}),
  };
}

/** Resolves when `ms` pass, so a request can stop waiting for a run without stopping the run. */
function pause(ms: number): Promise<"waited"> {
  return new Promise((resolve) => setTimeout(() => resolve("waited"), ms));
}

export async function registerControl(app: FastifyInstance): Promise<void> {
  const charter = readFileSync(join(app.config.serviceRoot, "prompts", "control.md"), "utf8");
  const completer = createDwarClient(app.config.env.dwarUrl);
  const runs = new ControlRuns();

  app.post("/control", async (request) => {
    const body = parse(controlBody, request.body);
    const run = runs.start(body.caller, () =>
      runControl({
        completer,
        tools: controlTools(app, body.caller),
        charter,
        request: body.request,
        caller: body.caller,
      }),
    );
    await Promise.race([run.settled, pause(body.wait_ms)]);
    return toRecord(run);
  });

  app.get("/control/:id", async (request) => {
    const { id } = parse(idParam, request.params);
    return toRecord(runs.get(id));
  });
}

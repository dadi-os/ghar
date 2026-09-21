/**
 * Hath Bluetooth radio. Commands are long-polled; advertisements and
 * notifications are posted back as events.
 */

import type { FastifyInstance } from "fastify";
import { parse, radioEventBody, radioPollQuery, radioReplyBody, radioSessionBody } from "./schemas.js";

export async function registerRadio(app: FastifyInstance): Promise<void> {
  app.post("/radio/attach", async (_request, reply) => {
    const session = app.controller.attachRadio();
    return reply.status(201).send(session);
  });

  app.post("/radio/detach", async (request) => {
    const body = parse(radioSessionBody, request.body);
    app.controller.detachRadio(body.session_id);
    return { status: "ok" };
  });

  app.get("/radio/commands", async (request) => {
    const query = parse(radioPollQuery, request.query);
    const command = await app.controller.pollRadio(query.session_id, query.wait_ms ?? 0);
    return { command };
  });

  app.post("/radio/reply", async (request) => {
    const body = parse(radioReplyBody, request.body);
    app.controller.replyRadio(body.session_id, body.id, body.ok, body.result, body.error);
    return { status: "ok" };
  });

  app.post("/radio/event", async (request) => {
    const body = parse(radioEventBody, request.body);
    app.controller.emitRadio(body.session_id, {
      kind: body.kind,
      address: body.address,
      ...(body.value_b64 !== undefined ? { value_b64: body.value_b64 } : {}),
    });
    return { status: "ok" };
  });
}

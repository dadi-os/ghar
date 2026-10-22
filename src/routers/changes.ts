/**
 * `GET /changes` — Server-Sent Events stream that emits `{ type: "changed", at }` when a
 * device attribute takes a new value and after every successful non-GET request (rooms,
 * devices, tags, commands, commissioning; the `/radio` relay carries Bluetooth traffic, not
 * data, so it publishes nothing). Clients refetch what they show. `/events` is the historical
 * event log, so the stream lives here.
 */

import type { ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";

const HEARTBEAT_MS = 20_000;

export async function registerChanges(app: FastifyInstance): Promise<void> {
  const streams = new Set<ServerResponse>();

  const publish = () => {
    const chunk = `data: ${JSON.stringify({ type: "changed", at: new Date().toISOString() })}\n\n`;
    for (const stream of streams) {
      stream.write(chunk);
    }
  };

  app.get("/changes", (request, reply) => {
    reply.hijack();
    const stream = reply.raw;
    stream.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    stream.write(": connected\n\n");
    streams.add(stream);
    const heartbeat = setInterval(() => stream.write(": ping\n\n"), HEARTBEAT_MS);

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      streams.delete(stream);
    });
  });

  const unsubscribe = app.controller.cache.onChange(publish);

  app.addHook("onResponse", async (request, reply) => {
    if (request.method !== "GET" && reply.statusCode < 400 && !request.url.startsWith("/radio/")) {
      publish();
    }
  });

  app.addHook("onClose", async () => {
    unsubscribe();
    for (const stream of streams) {
      stream.end();
    }
  });
}

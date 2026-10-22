import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import Fastify from "fastify";
import { StateCache } from "../src/matter/state-cache.js";
import { registerChanges } from "../src/routers/changes.js";

test("GET /changes publishes a new attribute value and a successful write, not a repeated value, a read or a failed write", async (t) => {
  const cache = new StateCache();
  const app = Fastify();
  app.decorate("controller", { cache } as never);
  await registerChanges(app);
  app.get("/rooms", async () => ({ rooms: [] }));
  app.post("/rooms", async () => ({ ok: true }));
  app.post("/radio/event", async () => ({ ok: true }));
  app.post("/broken", async (_request, reply) => reply.status(422).send({ error: "no" }));
  await app.listen({ port: 0, host: "127.0.0.1" });
  const url = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;

  const res = await fetch(`${url}/changes`);
  assert.equal(res.headers.get("content-type"), "text/event-stream");
  const reader = res.body!.getReader();
  t.after(async () => {
    await reader.cancel();
    await app.close();
  });
  const decoder = new TextDecoder();
  let received = "";
  void (async () => {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      received += decoder.decode(chunk.value);
    }
  })();

  cache.set("d1", "on", true);
  cache.set("d1", "on", true, { touchChangedAt: false });
  cache.set("d1", "on", false);
  await fetch(`${url}/rooms`);
  await fetch(`${url}/broken`, { method: "POST" });
  await fetch(`${url}/radio/event`, { method: "POST" });
  await fetch(`${url}/rooms`, { method: "POST" });
  await sleep(50);

  const events = received.split("\n\n").filter((part) => part.startsWith("data: "));
  assert.equal(events.length, 3);
  assert.equal(JSON.parse(events[0]!.slice(6)).type, "changed");
});

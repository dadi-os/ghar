import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { eventLogs, rooms } from "../src/db/schema.js";
import { FakeController } from "./fake-controller.js";
import {
  insertTestDevice,
  openTestDb,
  testConfig,
  truncateAll,
  unassignedRoomId,
} from "./helpers.js";

const config = testConfig();
const handle = await openTestDb();
const fake = new FakeController(handle.db);
const app = await buildApp(config, {
  db: handle.db,
  sql: handle.sql,
  controller: fake,
});

before(async () => {
  await migrate(config);
});

after(async () => {
  await app.close();
  await handle.close();
});

async function reset(): Promise<void> {
  await truncateAll(handle.sql);
  await migrate(config);
  fake.cache.clear();
  fake.commands.length = 0;
  fake.unreachable = false;
  fake.commissionMode = "succeed";
}

test("GET /health", async () => {
  const res = await app.inject({ method: "GET", url: "/health" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { status: "ok" });
});

test("GET /devices filters by room, tag, capability; unknown filters are empty", async () => {
  await reset();
  const unassigned = await unassignedRoomId(handle.db);
  const [living] = await handle.db.insert(rooms).values({ name: "living" }).returning();
  assert.ok(living);

  const bulb = await insertTestDevice(handle.db, {
    name: "bulb",
    roomId: living.id,
    capabilities: [
      { capability: "switchable" },
      { capability: "dimmable", config: { min: 0, max: 100 } },
      { capability: "colorable", config: { modes: ["hue_sat"] } },
    ],
  });
  const plug = await insertTestDevice(handle.db, {
    name: "plug",
    roomId: unassigned,
    capabilities: [{ capability: "switchable" }],
  });
  fake.seedState(bulb, "on", true);
  fake.seedState(bulb, "brightness", 40);

  await app.inject({
    method: "PATCH",
    url: `/devices/${bulb}`,
    payload: { tags: ["ambient", "downstairs"] },
  });

  const byRoom = await app.inject({ method: "GET", url: "/devices?room=living" });
  assert.equal(byRoom.statusCode, 200);
  assert.equal(byRoom.json().devices.length, 1);
  assert.equal(byRoom.json().devices[0].id, bulb);
  assert.equal(byRoom.json().devices[0].state.on.value, true);

  const byTag = await app.inject({ method: "GET", url: "/devices?tag=ambient" });
  assert.equal(byTag.json().devices.length, 1);

  const byCap = await app.inject({ method: "GET", url: "/devices?capability=colorable" });
  assert.equal(byCap.json().devices.length, 1);
  assert.equal(byCap.json().devices[0].id, bulb);

  const combo = await app.inject({
    method: "GET",
    url: "/devices?room=living&tag=ambient&capability=dimmable",
  });
  assert.equal(combo.json().devices.length, 1);

  const unknownRoom = await app.inject({ method: "GET", url: "/devices?room=nope" });
  assert.equal(unknownRoom.json().devices.length, 0);

  const unknownTag = await app.inject({ method: "GET", url: "/devices?tag=nope" });
  assert.equal(unknownTag.json().devices.length, 0);

  const all = await app.inject({ method: "GET", url: "/devices" });
  assert.equal(all.json().devices.length, 2);
  void plug;
});

test("command rejects unsupported capability and maps timeout to device_unreachable", async () => {
  await reset();
  const roomId = await unassignedRoomId(handle.db);
  const id = await insertTestDevice(handle.db, {
    name: "switch",
    roomId,
    capabilities: [{ capability: "switchable" }],
  });

  const unsupported = await app.inject({
    method: "POST",
    url: `/devices/${id}/command`,
    payload: { capability: "dimmable", params: { level: 40 } },
  });
  assert.equal(unsupported.statusCode, 422);
  assert.equal(unsupported.json().error.type, "capability_unsupported");

  fake.unreachable = true;
  const timeout = await app.inject({
    method: "POST",
    url: `/devices/${id}/command`,
    payload: { capability: "switchable", params: { state: "on" }, cause: "agent", cause_ref: "a1" },
  });
  assert.equal(timeout.statusCode, 504);
  assert.equal(timeout.json().error.type, "device_unreachable");
});

test("command attribution writes cause and cause_ref on the event row", async () => {
  await reset();
  const roomId = await unassignedRoomId(handle.db);
  const id = await insertTestDevice(handle.db, {
    name: "bulb",
    roomId,
    capabilities: [
      { capability: "switchable" },
      { capability: "dimmable", config: { min: 0, max: 100 } },
    ],
  });
  fake.seedState(id, "brightness", 10);

  const res = await app.inject({
    method: "POST",
    url: `/devices/${id}/command`,
    payload: {
      capability: "dimmable",
      params: { level: 40 },
      cause: "agent",
      cause_ref: "agent-42",
    },
  });
  assert.equal(res.statusCode, 200);

  const rows = await handle.db.select().from(eventLogs).where(eq(eventLogs.deviceId, id));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.cause, "agent");
  assert.equal(rows[0]?.causeRef, "agent-42");
  assert.equal(rows[0]?.newValue, 40);
});

test("room delete blocked while devices remain; unassigned is protected", async () => {
  await reset();
  const unassigned = await unassignedRoomId(handle.db);
  const [office] = await handle.db.insert(rooms).values({ name: "office" }).returning();
  assert.ok(office);
  await insertTestDevice(handle.db, { name: "lamp", roomId: office.id });

  const blocked = await app.inject({ method: "DELETE", url: `/rooms/${office.id}` });
  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.json().error.type, "conflict");

  const renameUnassigned = await app.inject({
    method: "PATCH",
    url: `/rooms/${unassigned}`,
    payload: { name: "other" },
  });
  assert.equal(renameUnassigned.statusCode, 409);

  const deleteUnassigned = await app.inject({ method: "DELETE", url: `/rooms/${unassigned}` });
  assert.equal(deleteUnassigned.statusCode, 409);
});

test("GET /events filters and since-as-id resumes without duplicates", async () => {
  await reset();
  const roomId = await unassignedRoomId(handle.db);
  const [den] = await handle.db.insert(rooms).values({ name: "den" }).returning();
  assert.ok(den);
  const a = await insertTestDevice(handle.db, {
    name: "a",
    roomId: den.id,
    capabilities: [{ capability: "switchable" }],
  });
  const b = await insertTestDevice(handle.db, {
    name: "b",
    roomId,
    capabilities: [{ capability: "switchable" }],
  });

  await handle.db.insert(eventLogs).values([
    {
      deviceId: a,
      attributeKey: "on",
      oldValue: false,
      newValue: true,
      cause: "external",
    },
    {
      deviceId: a,
      attributeKey: "on",
      oldValue: true,
      newValue: false,
      cause: "user",
      causeRef: "u1",
    },
    {
      deviceId: b,
      attributeKey: "on",
      oldValue: false,
      newValue: true,
      cause: "agent",
      causeRef: "ag",
    },
  ]);

  const byDevice = await app.inject({ method: "GET", url: `/events?device_id=${a}` });
  assert.equal(byDevice.json().events.length, 2);

  const byRoom = await app.inject({ method: "GET", url: "/events?room=den" });
  assert.equal(byRoom.json().events.length, 2);

  const byCause = await app.inject({ method: "GET", url: "/events?cause=external" });
  assert.equal(byCause.json().events.length, 1);

  const byKey = await app.inject({ method: "GET", url: "/events?key=on&device_id=" + a });
  assert.equal(byKey.json().events.length, 2);

  const firstPage = await app.inject({ method: "GET", url: "/events?limit=2&order=asc" });
  assert.equal(firstPage.json().events.length, 2);
  const lastId = firstPage.json().events[1].id as string;

  const resumed = await app.inject({
    method: "GET",
    url: `/events?since=${lastId}&order=asc`,
  });
  assert.equal(resumed.json().events.length, 1);
  assert.notEqual(resumed.json().events[0].id, lastId);

  const overLimit = await app.inject({
    method: "GET",
    url: `/events?limit=${config.page.max_size + 1}`,
  });
  assert.equal(overLimit.statusCode, 422);
  assert.equal(overLimit.json().error.type, "invalid_request");
});

test("unknown keys in request bodies are rejected", async () => {
  await reset();
  const res = await app.inject({
    method: "POST",
    url: "/rooms",
    payload: { name: "kitchen", extra: true },
  });
  assert.equal(res.statusCode, 422);
  assert.equal(res.json().error.type, "invalid_request");
});

test("commissioning job lifecycle: succeed, fail-late, and conflict", async () => {
  await reset();

  fake.commissionMode = "succeed";
  const started = await app.inject({
    method: "POST",
    url: "/commission",
    payload: { code: "34970112332" },
  });
  assert.equal(started.statusCode, 202);
  const jobId = started.json().job_id as string;

  let status = "pending";
  for (let i = 0; i < 50 && status !== "succeeded" && status !== "failed"; i++) {
    await new Promise((r) => setTimeout(r, 20));
    const poll = await app.inject({ method: "GET", url: `/commission/${jobId}` });
    assert.equal(poll.statusCode, 200);
    status = poll.json().status;
    if (status === "succeeded") {
      assert.ok(Array.isArray(poll.json().device_ids));
      assert.equal(poll.json().device_ids.length, 1);
    }
  }
  assert.equal(status, "succeeded");

  fake.commissionMode = "fail-late";
  const failStart = await app.inject({
    method: "POST",
    url: "/commission",
    payload: { code: "34970112332" },
  });
  const failId = failStart.json().job_id as string;
  let failStatus = "pending";
  for (let i = 0; i < 50 && failStatus !== "failed"; i++) {
    await new Promise((r) => setTimeout(r, 20));
    const poll = await app.inject({ method: "GET", url: `/commission/${failId}` });
    failStatus = poll.json().status;
    if (failStatus === "failed") {
      assert.match(poll.json().error, /attestation/i);
    }
  }
  assert.equal(failStatus, "failed");

  const conflict = await app.inject({
    method: "POST",
    url: "/commission",
    payload: { code: "conflict" },
  });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().error.type, "conflict");
});

test("GET /state returns cached values with changed_at", async () => {
  await reset();
  const roomId = await unassignedRoomId(handle.db);
  const id = await insertTestDevice(handle.db, {
    name: "sensor",
    roomId,
    capabilities: [{ capability: "sensor", config: { measurements: ["occupancy"] } }],
  });
  fake.seedState(id, "occupancy", false);
  const before = await app.inject({ method: "GET", url: "/state" });
  assert.equal(before.json().devices[id].occupancy.value, false);
  const changedAt = before.json().devices[id].occupancy.changed_at;

  await new Promise((r) => setTimeout(r, 5));
  fake.seedState(id, "occupancy", true);
  const after = await app.inject({ method: "GET", url: "/state" });
  assert.equal(after.json().devices[id].occupancy.value, true);
  assert.notEqual(after.json().devices[id].occupancy.changed_at, changedAt);
});

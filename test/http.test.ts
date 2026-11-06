import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { eventLogs } from "../src/db/schema.js";
import { controlTools } from "../src/control/tools.js";
import { FakeController } from "./fake-controller.js";
import {
  insertTestDevice,
  openTestDb,
  testConfig,
  truncateAll,
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

test("GET /devices filters by tag, capability, kind; unknown filters are empty", async () => {
  await reset();
  const bulb = await insertTestDevice(handle.db, {
    name: "bulb",
    capabilities: [
      { capability: "on_off" },
      { capability: "level", config: { min: 0, max: 100 } },
      { capability: "color", config: { modes: ["hue_sat"] } },
    ],
  });
  const plug = await insertTestDevice(handle.db, {
    name: "plug",
    kind: "plug",
    capabilities: [{ capability: "on_off" }],
  });
  fake.seedState(bulb, "on", true);
  fake.seedState(bulb, "brightness", 40);

  await app.inject({
    method: "PATCH",
    url: `/devices/${bulb}`,
    payload: { tags: ["living", "ambient"] },
  });

  const byLiving = await app.inject({ method: "GET", url: "/devices?tag=living" });
  assert.equal(byLiving.statusCode, 200);
  assert.equal(byLiving.json().devices.length, 1);
  assert.equal(byLiving.json().devices[0].id, bulb);
  assert.equal(byLiving.json().devices[0].state.on.value, true);
  assert.equal("room" in byLiving.json().devices[0], false);

  const byTag = await app.inject({ method: "GET", url: "/devices?tag=ambient" });
  assert.equal(byTag.json().devices.length, 1);

  const byCap = await app.inject({ method: "GET", url: "/devices?capability=color" });
  assert.equal(byCap.json().devices.length, 1);
  assert.equal(byCap.json().devices[0].id, bulb);

  const combo = await app.inject({
    method: "GET",
    url: "/devices?tag=ambient&capability=level",
  });
  assert.equal(combo.json().devices.length, 1);

  const unknownTag = await app.inject({ method: "GET", url: "/devices?tag=nope" });
  assert.equal(unknownTag.json().devices.length, 0);

  const byKind = await app.inject({ method: "GET", url: "/devices?kind=plug" });
  assert.equal(byKind.json().devices.length, 1);
  assert.equal(byKind.json().devices[0].id, plug);
  assert.equal(byKind.json().devices[0].kind, "plug");
  assert.equal(byKind.json().devices[0].bridge_name, null);

  const all = await app.inject({ method: "GET", url: "/devices" });
  assert.equal(all.json().devices.length, 2);
});

test("command rejects unsupported capability and maps timeout to device_unreachable", async () => {
  await reset();
  const id = await insertTestDevice(handle.db, {
    name: "switch",
    capabilities: [{ capability: "on_off" }],
  });

  const unsupported = await app.inject({
    method: "POST",
    url: `/devices/${id}/command`,
    payload: { capability: "level", command: "move_to", params: { level: 40 } },
  });
  assert.equal(unsupported.statusCode, 422);
  assert.equal(unsupported.json().error.type, "capability_unsupported");

  const unknownCommand = await app.inject({
    method: "POST",
    url: `/devices/${id}/command`,
    payload: { capability: "on_off", command: "flip" },
  });
  assert.equal(unknownCommand.statusCode, 422);
  assert.equal(unknownCommand.json().error.type, "invalid_request");

  const badParams = await app.inject({
    method: "POST",
    url: `/devices/${id}/command`,
    payload: { capability: "on_off", command: "on", params: { state: "on" } },
  });
  assert.equal(badParams.statusCode, 422);
  assert.equal(badParams.json().error.type, "invalid_request");
  assert.equal(fake.commands.length, 0);

  fake.unreachable = true;
  const timeout = await app.inject({
    method: "POST",
    url: `/devices/${id}/command`,
    payload: { capability: "on_off", command: "on", cause: "agent", cause_ref: "a1" },
  });
  assert.equal(timeout.statusCode, 504);
  assert.equal(timeout.json().error.type, "device_unreachable");
});

test("command attribution writes cause and cause_ref on the event row", async () => {
  await reset();
  const id = await insertTestDevice(handle.db, {
    name: "bulb",
    capabilities: [
      { capability: "on_off" },
      { capability: "level", config: { min: 0, max: 100 } },
    ],
  });
  fake.seedState(id, "brightness", 10);

  const res = await app.inject({
    method: "POST",
    url: `/devices/${id}/command`,
    payload: {
      capability: "level",
      command: "move_to",
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

test("tags: create with devices, rename, add and remove devices, delete; empty tags vanish", async () => {
  await reset();
  const lamp = await insertTestDevice(handle.db, { name: "lamp" });
  const strip = await insertTestDevice(handle.db, { name: "strip" });

  const created = await app.inject({
    method: "POST",
    url: "/tags",
    payload: { name: "ankur's room lights", device_ids: [lamp] },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().device_count, 1);
  const tagId = created.json().id as string;

  const duplicate = await app.inject({
    method: "POST",
    url: "/tags",
    payload: { name: "ankur's room lights", device_ids: [strip] },
  });
  assert.equal(duplicate.statusCode, 409);

  const missingDevice = await app.inject({
    method: "POST",
    url: "/tags",
    payload: { name: "ghost", device_ids: ["00000000-0000-4000-8000-000000000001"] },
  });
  assert.equal(missingDevice.statusCode, 404);

  const added = await app.inject({
    method: "POST",
    url: `/tags/${tagId}/devices`,
    payload: { device_ids: [lamp, strip] },
  });
  assert.equal(added.statusCode, 200);
  assert.equal(added.json().device_count, 2);

  const renamed = await app.inject({
    method: "PATCH",
    url: `/tags/${tagId}`,
    payload: { name: "ankur's bed lights" },
  });
  assert.equal(renamed.statusCode, 200);
  const byNew = await app.inject({ method: "GET", url: "/devices?tag=ankur's bed lights" });
  assert.equal(byNew.json().devices.length, 2);

  const other = await app.inject({
    method: "POST",
    url: "/tags",
    payload: { name: "all lights", device_ids: [lamp] },
  });
  const clash = await app.inject({
    method: "PATCH",
    url: `/tags/${other.json().id}`,
    payload: { name: "ankur's bed lights" },
  });
  assert.equal(clash.statusCode, 409);

  const removed = await app.inject({ method: "DELETE", url: `/tags/${tagId}/devices/${strip}` });
  assert.equal(removed.statusCode, 204);
  const detail = await app.inject({ method: "GET", url: `/devices/${lamp}` });
  assert.deepEqual(
    (detail.json().tags as Array<{ name: string }>).map((t) => t.name).sort(),
    ["all lights", "ankur's bed lights"],
  );

  const deleted = await app.inject({ method: "DELETE", url: `/tags/${tagId}` });
  assert.equal(deleted.statusCode, 204);
  const list = await app.inject({ method: "GET", url: "/tags" });
  assert.deepEqual((list.json().tags as Array<{ name: string }>).map((t) => t.name), ["all lights"]);

  const lastRemoved = await app.inject({ method: "DELETE", url: `/tags/${other.json().id}/devices/${lamp}` });
  assert.equal(lastRemoved.statusCode, 204);
  const empty = await app.inject({ method: "GET", url: "/tags" });
  assert.equal(empty.json().tags.length, 0);
});

test("control tools tag, untag and rename; a missing tag or device is refused", async () => {
  await reset();
  const lamp = await insertTestDevice(handle.db, { name: "lamp" });
  const strip = await insertTestDevice(handle.db, { name: "strip" });
  const tools = controlTools({ db: handle.db, controller: fake }, "agent-1");

  await tools.call("tag_devices", { tag: "ankur's bed lights", device_ids: [lamp, strip] });
  await tools.call("tag_devices", { tag: "ankur's bed lights", device_ids: [lamp] });
  const tagged = await app.inject({ method: "GET", url: "/devices?tag=ankur's bed lights" });
  assert.equal(tagged.json().devices.length, 2);

  await tools.call("rename_tag", { tag: "ankur's bed lights", new_name: "bed lights" });
  const renamed = await app.inject({ method: "GET", url: "/devices?tag=bed lights" });
  assert.equal(renamed.json().devices.length, 2);

  await tools.call("untag_devices", { tag: "bed lights", device_ids: [strip] });
  const left = await app.inject({ method: "GET", url: "/devices?tag=bed lights" });
  assert.deepEqual((left.json().devices as Array<{ id: string }>).map((d) => d.id), [lamp]);

  await tools.call("untag_devices", { tag: "bed lights", device_ids: [lamp] });
  const gone = await app.inject({ method: "GET", url: "/tags" });
  assert.equal(gone.json().tags.length, 0);

  await assert.rejects(() => tools.call("untag_devices", { tag: "nope", device_ids: [lamp] }), /no tag named nope/);
  await assert.rejects(
    () => tools.call("tag_devices", { tag: "ghost", device_ids: ["00000000-0000-4000-8000-000000000001"] }),
    /device not found/,
  );
});

test("GET /events filters and since-as-id resumes without duplicates", async () => {
  await reset();
  const a = await insertTestDevice(handle.db, {
    name: "a",
    capabilities: [{ capability: "on_off" }],
  });
  const b = await insertTestDevice(handle.db, {
    name: "b",
    capabilities: [{ capability: "on_off" }],
  });

  await app.inject({ method: "PATCH", url: `/devices/${a}`, payload: { tags: ["den"] } });

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

  const byTag = await app.inject({ method: "GET", url: "/events?tag=den" });
  assert.equal(byTag.json().events.length, 2);

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
    url: "/tags",
    payload: { name: "kitchen", device_ids: [], extra: true },
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

test("commissioning tags a new device with the requested tags", async () => {
  await reset();

  fake.commissionMode = "succeed";
  const started = await app.inject({
    method: "POST",
    url: "/commission",
    payload: { code: "34970112332", tags: ["kitchen", "all lights"] },
  });
  assert.equal(started.statusCode, 202);
  const jobId = started.json().job_id as string;

  let status = "pending";
  for (let i = 0; i < 50 && status !== "succeeded" && status !== "failed"; i++) {
    await new Promise((r) => setTimeout(r, 20));
    const poll = await app.inject({ method: "GET", url: `/commission/${jobId}` });
    status = poll.json().status;
  }
  assert.equal(status, "succeeded");

  const tagged = await app.inject({ method: "GET", url: "/devices?tag=kitchen" });
  assert.equal(tagged.json().devices.length, 1);
  assert.deepEqual(
    (tagged.json().devices[0].tags as Array<{ name: string }>).map((t) => t.name).sort(),
    ["all lights", "kitchen"],
  );
});

test("nearby commissioning requires wifi and an attached radio", async () => {
  await reset();
  const missingWifi = await app.inject({
    method: "POST",
    url: "/commission",
    payload: { code: "34970112332", radio: "nearby" },
  });
  assert.equal(missingWifi.statusCode, 422);
  assert.equal(missingWifi.json().error.type, "invalid_request");

  const missingRadio = await app.inject({
    method: "POST",
    url: "/commission",
    payload: {
      code: "34970112332",
      radio: "nearby",
      wifi: { ssid: "house", password: "secret" },
    },
  });
  assert.equal(missingRadio.statusCode, 422);
  assert.equal(missingRadio.json().error.type, "radio_unavailable");

  const attached = await app.inject({ method: "POST", url: "/radio/attach" });
  assert.equal(attached.statusCode, 201);
  const sessionId = attached.json().session_id as string;
  const again = await app.inject({ method: "POST", url: "/radio/attach" });
  assert.equal(again.statusCode, 409);

  const idle = await app.inject({
    method: "GET",
    url: `/radio/commands?session_id=${sessionId}&wait_ms=0`,
  });
  assert.equal(idle.statusCode, 200);
  assert.equal(idle.json().command, null);

  fake.commissionMode = "succeed";
  const started = await app.inject({
    method: "POST",
    url: "/commission",
    payload: {
      code: "34970112332",
      radio: "nearby",
      wifi: { ssid: "house", password: "secret" },
    },
  });
  assert.equal(started.statusCode, 202);
  const jobId = started.json().job_id as string;
  let body = "";
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 20));
    const poll = await app.inject({ method: "GET", url: `/commission/${jobId}` });
    body = poll.body;
    if (poll.json().status === "succeeded" || poll.json().status === "failed") {
      break;
    }
  }
  assert.equal(JSON.parse(body).status, "succeeded");
  assert.equal(body.includes("secret"), false);

  const detached = await app.inject({
    method: "POST",
    url: "/radio/detach",
    payload: { session_id: sessionId },
  });
  assert.equal(detached.statusCode, 200);
  const stale = await app.inject({
    method: "GET",
    url: `/radio/commands?session_id=${sessionId}&wait_ms=0`,
  });
  assert.equal(stale.statusCode, 409);

  const bare = await app.inject({
    method: "POST",
    url: "/radio/reply",
    payload: { session_id: sessionId, id: 1, ok: false },
  });
  assert.equal(bare.statusCode, 422);
  assert.equal(bare.json().error.type, "invalid_request");
});

test("GET /state returns cached values with changed_at", async () => {
  await reset();
  const id = await insertTestDevice(handle.db, {
    name: "sensor",
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

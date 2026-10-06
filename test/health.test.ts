import assert from "node:assert/strict";
import { after, test } from "node:test";
import { buildApp } from "../src/app.js";
import { FakeController } from "./fake-controller.js";
import { openTestDb, testConfig } from "./helpers.js";

const config = testConfig();
const handle = await openTestDb();
const fake = new FakeController(handle.db);
const app = await buildApp(config, {
  db: handle.db,
  sql: handle.sql,
  controller: fake,
});

after(async () => {
  await app.close();
  await handle.close();
});

test("GET /health is ok while the Matter controller has not failed", async () => {
  fake.startFailure = undefined;
  const res = await app.inject({ method: "GET", url: "/health" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { status: "ok" });
});

test("GET /health reports a failed Matter controller start as 503 matter_unavailable", async () => {
  fake.startFailure = new Error("mdns bind EADDRINUSE");
  const res = await app.inject({ method: "GET", url: "/health" });
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().error.type, "matter_unavailable");
  assert.match(res.json().error.message, /EADDRINUSE/);
});

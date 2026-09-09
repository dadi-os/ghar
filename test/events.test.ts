import assert from "node:assert/strict";
import { test } from "node:test";
import { applyObservation } from "../src/matter/events.js";
import { PendingCauseTracker } from "../src/matter/cause.js";
import { StateCache } from "../src/matter/state-cache.js";
import { createLogger } from "../src/logging.js";

test("applyObservation seeds without writing events and attributes cause on change", async () => {
  const inserts: Array<Record<string, unknown>> = [];
  const db = {
    insert() {
      return {
        values(row: Record<string, unknown>) {
          inserts.push(row);
          return Promise.resolve();
        },
      };
    },
  };

  const cache = new StateCache();
  const causes = new PendingCauseTracker({ ttlMs: 5_000 });
  const log = createLogger();
  const deps = { db: db as never, cache, causes, log };

  await applyObservation(deps, { deviceId: "d1", attributeKey: "on", value: false, seed: true });
  assert.equal(inserts.length, 0);
  assert.equal(cache.get("d1", "on")?.value, false);

  causes.note("d1", "on", "user", "u1");
  await applyObservation(deps, { deviceId: "d1", attributeKey: "on", value: true });
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0]?.cause, "user");
  assert.equal(inserts[0]?.causeRef, "u1");
  assert.equal(inserts[0]?.newValue, true);

  await applyObservation(deps, { deviceId: "d1", attributeKey: "temperature", value: 20, seed: true });
  await applyObservation(deps, { deviceId: "d1", attributeKey: "temperature", value: 20.2 });
  assert.equal(inserts.length, 1); // deadband suppressed
  assert.equal(cache.get("d1", "temperature")?.value, 20.2);

  await applyObservation(deps, { deviceId: "d1", attributeKey: "temperature", value: 21 });
  assert.equal(inserts.length, 2);
  assert.equal(inserts[1]?.cause, "external");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { ClusterId, deriveCapabilities } from "../src/matter/capabilities.js";
import { brightnessFromMatter, brightnessToMatter } from "../src/matter/brightness.js";
import { PendingCauseTracker } from "../src/matter/cause.js";
import { isSignificantChange } from "../src/matter/deadband.js";

test("on/off bulb maps to switchable only", () => {
  const caps = deriveCapabilities({
    endpoint: 1,
    serverList: [ClusterId.OnOff],
  });
  assert.deepEqual(
    caps.map((c) => c.capability),
    ["switchable"],
  );
});

test("dimmable bulb maps to switchable + dimmable", () => {
  const caps = deriveCapabilities({
    endpoint: 1,
    serverList: [ClusterId.OnOff, ClusterId.LevelControl],
  });
  assert.deepEqual(
    caps.map((c) => c.capability),
    ["switchable", "dimmable"],
  );
  assert.deepEqual(caps[1]?.config, { min: 0, max: 100 });
});

test("color bulb maps to switchable, dimmable, colorable", () => {
  const caps = deriveCapabilities({
    endpoint: 1,
    serverList: [ClusterId.OnOff, ClusterId.LevelControl, ClusterId.ColorControl],
    colorFeatures: { hueSaturation: true, colorTemperature: true },
  });
  assert.deepEqual(
    caps.map((c) => c.capability),
    ["switchable", "dimmable", "colorable"],
  );
  assert.deepEqual(caps[2]?.config, { modes: ["hue_sat", "color_temp"] });
});

test("switch maps to switchable", () => {
  const caps = deriveCapabilities({ endpoint: 1, serverList: [ClusterId.OnOff] });
  assert.deepEqual(
    caps.map((c) => c.capability),
    ["switchable"],
  );
});

test("lock maps to lockable", () => {
  const caps = deriveCapabilities({ endpoint: 1, serverList: [ClusterId.DoorLock] });
  assert.deepEqual(
    caps.map((c) => c.capability),
    ["lockable"],
  );
});

test("thermostat maps to thermostat", () => {
  const caps = deriveCapabilities({ endpoint: 1, serverList: [ClusterId.Thermostat] });
  assert.deepEqual(
    caps.map((c) => c.capability),
    ["thermostat"],
  );
});

test("multi-sensor endpoint records measurement types", () => {
  const caps = deriveCapabilities({
    endpoint: 1,
    serverList: [
      ClusterId.OccupancySensing,
      ClusterId.TemperatureMeasurement,
      ClusterId.RelativeHumidityMeasurement,
      ClusterId.BooleanState,
    ],
  });
  assert.equal(caps.length, 1);
  assert.equal(caps[0]?.capability, "sensor");
  assert.deepEqual(caps[0]?.config, {
    measurements: ["occupancy", "temperature", "humidity", "contact"],
  });
});

test("multi-endpoint node: each endpoint derives independently", () => {
  const outlet = deriveCapabilities({ endpoint: 1, serverList: [ClusterId.OnOff] });
  const dimmer = deriveCapabilities({
    endpoint: 2,
    serverList: [ClusterId.OnOff, ClusterId.LevelControl],
  });
  assert.deepEqual(
    outlet.map((c) => c.capability),
    ["switchable"],
  );
  assert.deepEqual(
    dimmer.map((c) => c.capability),
    ["switchable", "dimmable"],
  );
});

test("media clusters map to media", () => {
  const caps = deriveCapabilities({
    endpoint: 1,
    serverList: [ClusterId.MediaPlayback, ClusterId.KeypadInput],
  });
  assert.deepEqual(
    caps.map((c) => c.capability),
    ["media"],
  );
});

test("brightness 0-100 converts to Matter 0-254 and back at boundaries", () => {
  assert.equal(brightnessToMatter(0), 0);
  assert.equal(brightnessToMatter(100), 254);
  assert.equal(brightnessFromMatter(0), 0);
  assert.equal(brightnessFromMatter(254), 100);
});

test("brightness rounding keeps 100 reachable and is stable at midpoints", () => {
  assert.equal(brightnessToMatter(40), Math.round((40 * 254) / 100));
  assert.equal(brightnessFromMatter(brightnessToMatter(40)), 40);
  assert.equal(brightnessFromMatter(brightnessToMatter(100)), 100);
  assert.equal(brightnessFromMatter(1), Math.round(100 / 254));
});

test("cause attribution uses pending window with fake clock", () => {
  let now = 1_000;
  const tracker = new PendingCauseTracker({ ttlMs: 5_000, now: () => now });
  tracker.note("dev-1", "on", "agent", "agent-9");

  assert.deepEqual(tracker.attribute("dev-1", "on"), {
    cause: "agent",
    causeRef: "agent-9",
  });

  tracker.note("dev-1", "on", "user", "user-1");
  now = 6_001;
  assert.deepEqual(tracker.attribute("dev-1", "on"), { cause: "external" });

  assert.deepEqual(tracker.attribute("dev-1", "brightness"), { cause: "external" });
});

test("deadband filters at, just below, and just above threshold", () => {
  assert.equal(isSignificantChange("temperature", 20.0, 20.3), false);
  assert.equal(isSignificantChange("temperature", 20.0, 20.31), true);
  assert.equal(isSignificantChange("temperature", 20.0, 20.29), false);

  assert.equal(isSignificantChange("humidity", 40, 41), false);
  assert.equal(isSignificantChange("humidity", 40, 41.1), true);

  assert.equal(isSignificantChange("on", false, true), true);
  assert.equal(isSignificantChange("on", true, true), false);
});

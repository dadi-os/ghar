import assert from "node:assert/strict";
import { test } from "node:test";
import { OBSERVED_ATTRIBUTES, OBSERVED_EVENTS, stateKey } from "../src/matter/attributes.js";
import {
  Behavior,
  CAPABILITIES,
  deriveCapabilities,
  deriveKind,
  type EndpointDescriptor,
} from "../src/matter/capabilities.js";
import { COMMANDS } from "../src/matter/commands/index.js";
import { brightnessFromMatter, brightnessToMatter } from "../src/matter/brightness.js";
import { PendingCauseTracker } from "../src/matter/cause.js";
import { isSignificantChange } from "../src/matter/deadband.js";

/** An endpoint descriptor with only the given behaviors, features and state. */
function endpoint(
  behaviors: string[],
  extra: { deviceTypes?: number[]; features?: EndpointDescriptor["features"]; state?: EndpointDescriptor["state"] } = {},
): EndpointDescriptor {
  return {
    deviceTypes: extra.deviceTypes ?? [],
    behaviors,
    features: extra.features ?? {},
    state: extra.state ?? {},
  };
}

const names = (caps: Array<{ capability: string }>) => caps.map((c) => c.capability);

test("kind comes from the first application device type, skipping utility types", () => {
  assert.equal(deriveKind([0x0013, 0x010d]), "light");
  assert.equal(deriveKind([0x0011, 0x0510, 0x010a]), "plug");
  assert.equal(deriveKind([0x0510]), "energy_meter");
  assert.equal(deriveKind([0x0074]), "robot_vacuum");
  assert.equal(deriveKind([0x000e]), "bridge");
  assert.equal(deriveKind([0xfff1]), "other");
  assert.equal(deriveKind([]), "other");
});

test("a color bulb maps to on_off, level and color with its modes", () => {
  const caps = deriveCapabilities(
    endpoint([Behavior.OnOff, Behavior.LevelControl, Behavior.ColorControl], {
      features: { colorControl: { hueSaturation: true, colorTemperature: true } },
    }),
    "light",
  );
  assert.deepEqual(names(caps), ["on_off", "level", "color"]);
  assert.deepEqual(caps[1]?.config, { min: 0, max: 100 });
  assert.deepEqual(caps[2]?.config, { modes: ["hue_sat", "color_temp"] });
});

test("a white-only bulb lists only color temperature", () => {
  const caps = deriveCapabilities(
    endpoint([Behavior.ColorControl], { features: { colorControl: { colorTemperature: true } } }),
    "light",
  );
  assert.deepEqual(caps[0]?.config, { modes: ["color_temp"] });
});

test("a covering reports which positions it can reach", () => {
  const caps = deriveCapabilities(
    endpoint([Behavior.WindowCovering], { features: { windowCovering: { lift: true, positionAwareLift: true } } }),
    "cover",
  );
  assert.deepEqual(caps, [{ capability: "cover", config: { lift: true, tilt: false } }]);
});

test("a thermostat reports whether it heats, cools and runs auto", () => {
  const caps = deriveCapabilities(
    endpoint([Behavior.Thermostat, Behavior.FanControl], {
      features: { thermostat: { heating: true, cooling: true }, fanControl: { rocking: true } },
    }),
    "air_conditioner",
  );
  assert.deepEqual(names(caps), ["fan", "thermostat"]);
  assert.deepEqual(caps[1]?.config, { heat: true, cool: true, auto: false });
  assert.deepEqual(caps[0]?.config, { auto: false, rock: true, wind: false });
});

test("Boolean State reads as what the device kind detects", () => {
  const contact = deriveCapabilities(endpoint([Behavior.BooleanState]), "contact");
  const leak = deriveCapabilities(endpoint([Behavior.BooleanState]), "leak");
  assert.deepEqual(contact[0]?.config, { measurements: ["contact"] });
  assert.deepEqual(leak[0]?.config, { measurements: ["leak"] });
});

test("an air monitor lists each measurement with its concentration unit", () => {
  const caps = deriveCapabilities(
    endpoint(
      [Behavior.TemperatureMeasurement, Behavior.AirQuality, "pm25ConcentrationMeasurement", "carbonDioxideConcentrationMeasurement"],
      { state: { pm25ConcentrationMeasurement: { measurementUnit: 4 }, carbonDioxideConcentrationMeasurement: { measurementUnit: 0 } } },
    ),
    "air_quality",
  );
  assert.deepEqual(caps, [
    {
      capability: "sensor",
      config: { measurements: ["temperature", "air_quality", "pm25", "co2"], units: { pm25: "ug/m3", co2: "ppm" } },
    },
  ]);
});

test("a robot vacuum lists its modes and areas; its operational state is not an appliance", () => {
  const caps = deriveCapabilities(
    endpoint([Behavior.RvcRunMode, Behavior.RvcCleanMode, Behavior.RvcOperationalState, Behavior.ServiceArea, Behavior.PowerSource], {
      features: { powerSource: { battery: true } },
      state: {
        rvcRunMode: { supportedModes: [{ mode: 0, label: "Idle", modeTags: [] }, { mode: 1, label: "Cleaning", modeTags: [] }] },
        rvcCleanMode: { supportedModes: [{ mode: 3, label: "Mop", modeTags: [] }] },
        serviceArea: {
          supportedAreas: [
            { areaId: 7, mapId: null, areaInfo: { locationInfo: { locationName: "Kitchen" }, landmarkInfo: null } },
            { areaId: 8, mapId: null, areaInfo: { locationInfo: null, landmarkInfo: null } },
          ],
        },
      },
    }),
    "robot_vacuum",
  );
  assert.deepEqual(names(caps), ["power_source", "rvc"]);
  assert.deepEqual(caps[1]?.config, {
    run_modes: [{ id: 0, label: "Idle" }, { id: 1, label: "Cleaning" }],
    clean_modes: [{ id: 3, label: "Mop" }],
    areas: [{ id: 7, label: "Kitchen" }, { id: 8, label: "Area 8" }],
  });
});

test("a washer has an appliance cycle and its modes", () => {
  const caps = deriveCapabilities(
    endpoint([Behavior.OperationalState, "laundryWasherMode"], {
      state: { laundryWasherMode: { supportedModes: [{ mode: 2, label: "Cotton", modeTags: [] }] } },
    }),
    "washer",
  );
  assert.deepEqual(caps, [
    { capability: "appliance", config: {} },
    { capability: "mode", config: { modes: [{ id: 2, label: "Cotton" }] } },
  ]);
});

test("temperature control reports degrees or levels by feature", () => {
  const numeric = deriveCapabilities(
    endpoint([Behavior.TemperatureControl], {
      features: { temperatureControl: { temperatureNumber: true } },
      state: { temperatureControl: { minTemperature: 5000, maxTemperature: 25000, step: 500 } },
    }),
    "oven",
  );
  const levels = deriveCapabilities(
    endpoint([Behavior.TemperatureControl], { state: { temperatureControl: { supportedTemperatureLevels: ["Cold", "Colder"] } } }),
    "refrigerator",
  );
  assert.deepEqual(numeric[0]?.config, { numeric: true, min: 50, max: 250, step: 5 });
  assert.deepEqual(levels[0]?.config, { numeric: false, levels: ["Cold", "Colder"] });
});

test("media, buttons, alarms, energy and camera privacy map to their capabilities", () => {
  const tv = deriveCapabilities(
    endpoint([Behavior.OnOff, Behavior.MediaPlayback, Behavior.MediaInput, Behavior.KeypadInput], {
      state: { mediaInput: { inputList: [{ index: 1, inputType: 0, name: "HDMI 1", description: "" }] } },
    }),
    "tv",
  );
  assert.deepEqual(tv[1], {
    capability: "media",
    config: { playback: true, inputs: [{ id: 1, label: "HDMI 1" }], keypad: true, apps: false },
  });
  assert.deepEqual(
    names(deriveCapabilities(endpoint([Behavior.Switch], { state: { switch: { numberOfPositions: 2 } } }), "switch")),
    ["button"],
  );
  assert.deepEqual(names(deriveCapabilities(endpoint([Behavior.SmokeCoAlarm]), "smoke_alarm")), ["alarm"]);
  assert.deepEqual(names(deriveCapabilities(endpoint([Behavior.ElectricalPowerMeasurement]), "energy_meter")), ["energy"]);
  assert.deepEqual(names(deriveCapabilities(endpoint([Behavior.CameraAvStreamManagement]), "camera")), []);
  assert.deepEqual(
    names(deriveCapabilities(endpoint([Behavior.CameraAvStreamManagement], { features: { cameraAvStreamManagement: { privacy: true } } }), "camera")),
    ["camera"],
  );
});

test("an endpoint with nothing Ghar reads has no capabilities", () => {
  assert.deepEqual(deriveCapabilities(endpoint(["descriptor", "identify"]), "bridge"), []);
});

/** The mapper for one observed attribute. */
function mapper(behavior: string, attribute: string) {
  const entry = OBSERVED_ATTRIBUTES.find((item) => item.behavior === behavior && item.attribute === attribute);
  assert.ok(entry, `${behavior}.${attribute} is not observed`);
  return entry;
}

test("attribute mappers convert Matter units to Ghar units", () => {
  assert.equal(mapper(Behavior.WindowCovering, "currentPositionLiftPercent100ths").map(2500, {}), 75);
  assert.equal(mapper(Behavior.Thermostat, "occupiedHeatingSetpoint").map(2150, {}), 21.5);
  assert.equal(mapper(Behavior.Thermostat, "systemMode").map(4, {}), "heat");
  assert.equal(mapper(Behavior.Thermostat, "thermostatRunningState").map({ heat: false, cool: true }, {}), "cooling");
  assert.equal(mapper(Behavior.Thermostat, "thermostatRunningState").map({}, {}), "idle");
  assert.equal(mapper(Behavior.IlluminanceMeasurement, "measuredValue").map(25_315, {}), 340);
  assert.equal(mapper(Behavior.IlluminanceMeasurement, "measuredValue").map(0, {}), 0);
  assert.equal(mapper(Behavior.PressureMeasurement, "measuredValue").map(1013, {}), 101.3);
  assert.equal(mapper(Behavior.PowerSource, "batPercentRemaining").map(128, {}), 64);
  assert.equal(mapper(Behavior.ElectricalPowerMeasurement, "activePower").map(412_000n, {}), 412);
  assert.equal(mapper(Behavior.ElectricalEnergyMeasurement, "cumulativeEnergyImported").map({ energy: 2_800_000 }, {}), 2.8);
  assert.equal(mapper(Behavior.RvcOperationalState, "operationalState").map(0x42, {}), "docked");
  assert.equal(mapper(Behavior.Thermostat, "localTemperature").map(null, {}), undefined);
});

test("mode, phase and input mappers resolve ids against the device's own lists", () => {
  const modes = { supportedModes: [{ mode: 2, label: "Cotton" }] };
  assert.equal(mapper("laundryWasherMode", "currentMode").map(2, modes), "Cotton");
  assert.equal(mapper("laundryWasherMode", "currentMode").map(9, modes), undefined);
  assert.equal(mapper(Behavior.OperationalState, "currentPhase").map(1, { phaseList: ["Wash", "Rinse"] }), "Rinse");
  assert.equal(mapper(Behavior.MediaInput, "currentInput").map(1, { inputList: [{ index: 1, name: "HDMI 1" }] }), "HDMI 1");
});

test("state keys follow the device kind for level and Boolean State", () => {
  const level = mapper(Behavior.LevelControl, "currentLevel");
  const contact = mapper(Behavior.BooleanState, "stateValue");
  assert.equal(stateKey(level, "speaker"), "volume");
  assert.equal(stateKey(level, "light"), "brightness");
  assert.equal(stateKey(contact, "leak"), "leak");
  assert.equal(stateKey(contact, "contact"), "contact");
});

test("button and lock events map to their logged values", () => {
  const short = OBSERVED_EVENTS.find((item) => item.event === "shortRelease");
  const multi = OBSERVED_EVENTS.find((item) => item.event === "multiPressComplete");
  const lock = OBSERVED_EVENTS.find((item) => item.event === "lockOperation");
  assert.ok(short && multi && lock);
  assert.deepEqual(short.map({ previousPosition: 1 }), { action: "press", position: 1 });
  assert.deepEqual(multi.map({ previousPosition: 1, totalNumberOfPressesCounted: 2 }), {
    action: "multi_press",
    position: 1,
    count: 2,
  });
  assert.equal(short.when?.({ momentarySwitchMultiPress: true }), false);
  assert.deepEqual(lock.map({ lockOperationType: 1, operationSource: 3 }), { operation: "unlock", source: "keypad" });
});

test("every command table belongs to a known capability", () => {
  for (const capability of Object.keys(COMMANDS)) {
    assert.ok((CAPABILITIES as readonly string[]).includes(capability), capability);
  }
  assert.deepEqual(Object.keys(COMMANDS.on_off ?? {}), ["on", "off", "toggle"]);
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

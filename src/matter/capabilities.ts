/**
 * Classify a Matter endpoint: its device kind from the Descriptor device types, and its
 * Ghar capabilities from the client behaviors it exposes, their features and the option
 * lists (modes, areas, inputs) it reports. Pure: no I/O, no Matter runtime.
 */

/** What a device is, from its Matter device type. Drives how it is drawn and described. */
export const DEVICE_KINDS = [
  "light",
  "plug",
  "switch",
  "cover",
  "fan",
  "air_purifier",
  "thermostat",
  "air_conditioner",
  "heat_pump",
  "water_heater",
  "lock",
  "contact",
  "occupancy",
  "light_sensor",
  "temperature",
  "humidity",
  "pressure",
  "flow",
  "leak",
  "freeze",
  "rain",
  "air_quality",
  "smoke_alarm",
  "energy_meter",
  "solar",
  "battery_storage",
  "ev_charger",
  "valve",
  "irrigation",
  "pump",
  "robot_vacuum",
  "washer",
  "dryer",
  "dishwasher",
  "refrigerator",
  "cabinet",
  "oven",
  "cooktop",
  "microwave",
  "extractor_hood",
  "speaker",
  "tv",
  "camera",
  "doorbell",
  "bridge",
  "other",
] as const;

export type DeviceKind = (typeof DEVICE_KINDS)[number];

/** What Ghar can read or command on an endpoint. Each one names a set of state keys and commands. */
export const CAPABILITIES = [
  "on_off",
  "level",
  "color",
  "cover",
  "fan",
  "thermostat",
  "lock",
  "sensor",
  "button",
  "alarm",
  "power_source",
  "energy",
  "valve",
  "pump",
  "rvc",
  "appliance",
  "mode",
  "temperature_control",
  "media",
  "camera",
] as const;

export type GharCapability = (typeof CAPABILITIES)[number];

export type ConcentrationMeasurement =
  | "pm25"
  | "pm10"
  | "pm1"
  | "co2"
  | "co"
  | "no2"
  | "o3"
  | "tvoc"
  | "formaldehyde"
  | "radon";

/** One measured quantity a sensor endpoint reports; each is also its state key. */
export type SensorMeasurement =
  | "occupancy"
  | "temperature"
  | "humidity"
  | "contact"
  | "leak"
  | "freeze"
  | "rain"
  | "illuminance"
  | "pressure"
  | "flow"
  | "air_quality"
  | ConcentrationMeasurement;

export type ColorMode = "hue_sat" | "color_temp";

export type CapabilityRecord = {
  capability: GharCapability;
  config: Record<string, unknown>;
};

/** Device type ids that describe plumbing rather than the device, skipped when choosing a kind. */
const UTILITY_DEVICE_TYPES = new Set([0x0011, 0x0012, 0x0013, 0x0014, 0x0016, 0x050d, 0x0510]);

/** Electrical Sensor: the device type of an endpoint that only measures power. */
const ELECTRICAL_SENSOR_TYPE = 0x0510;

/** Matter device type id → Ghar kind (Matter 1.4 device library). */
export const KIND_BY_DEVICE_TYPE: ReadonlyMap<number, DeviceKind> = new Map<number, DeviceKind>([
  [0x0100, "light"],
  [0x0101, "light"],
  [0x010c, "light"],
  [0x010d, "light"],
  [0x010a, "plug"],
  [0x010b, "plug"],
  [0x010f, "plug"],
  [0x0110, "plug"],
  [0x000f, "switch"],
  [0x0103, "switch"],
  [0x0104, "switch"],
  [0x0105, "switch"],
  [0x0202, "cover"],
  [0x002b, "fan"],
  [0x002d, "air_purifier"],
  [0x0301, "thermostat"],
  [0x0072, "air_conditioner"],
  [0x0309, "heat_pump"],
  [0x050f, "water_heater"],
  [0x000a, "lock"],
  [0x0015, "contact"],
  [0x0107, "occupancy"],
  [0x0106, "light_sensor"],
  [0x0302, "temperature"],
  [0x0307, "humidity"],
  [0x0305, "pressure"],
  [0x0306, "flow"],
  [0x0043, "leak"],
  [0x0041, "freeze"],
  [0x0044, "rain"],
  [0x002c, "air_quality"],
  [0x0076, "smoke_alarm"],
  [0x0514, "energy_meter"],
  [0x0017, "solar"],
  [0x0018, "battery_storage"],
  [0x050c, "ev_charger"],
  [0x0042, "valve"],
  [0x0040, "irrigation"],
  [0x0303, "pump"],
  [0x0074, "robot_vacuum"],
  [0x0073, "washer"],
  [0x007c, "dryer"],
  [0x0075, "dishwasher"],
  [0x0070, "refrigerator"],
  [0x0071, "cabinet"],
  [0x007b, "oven"],
  [0x0078, "cooktop"],
  [0x0077, "cooktop"],
  [0x0079, "microwave"],
  [0x007a, "extractor_hood"],
  [0x0022, "speaker"],
  [0x0028, "tv"],
  [0x0023, "tv"],
  [0x0142, "camera"],
  [0x0144, "camera"],
  [0x0145, "camera"],
  [0x0143, "doorbell"],
  [0x0148, "doorbell"],
  [0x000e, "bridge"],
]);

/**
 * The kind of an endpoint: its first application device type Ghar knows, else
 * `energy_meter` for a bare electrical sensor, else `other`.
 */
export function deriveKind(deviceTypes: readonly number[]): DeviceKind {
  for (const type of deviceTypes) {
    if (UTILITY_DEVICE_TYPES.has(type)) {
      continue;
    }
    const kind = KIND_BY_DEVICE_TYPE.get(type);
    if (kind) {
      return kind;
    }
  }
  return deviceTypes.includes(ELECTRICAL_SENSOR_TYPE) ? "energy_meter" : "other";
}

/** Client behavior ids (cluster property names) Ghar reads. */
export const Behavior = {
  OnOff: "onOff",
  LevelControl: "levelControl",
  ColorControl: "colorControl",
  WindowCovering: "windowCovering",
  FanControl: "fanControl",
  Thermostat: "thermostat",
  DoorLock: "doorLock",
  BooleanState: "booleanState",
  OccupancySensing: "occupancySensing",
  TemperatureMeasurement: "temperatureMeasurement",
  RelativeHumidityMeasurement: "relativeHumidityMeasurement",
  IlluminanceMeasurement: "illuminanceMeasurement",
  PressureMeasurement: "pressureMeasurement",
  FlowMeasurement: "flowMeasurement",
  AirQuality: "airQuality",
  SmokeCoAlarm: "smokeCoAlarm",
  PowerSource: "powerSource",
  ElectricalPowerMeasurement: "electricalPowerMeasurement",
  ElectricalEnergyMeasurement: "electricalEnergyMeasurement",
  Valve: "valveConfigurationAndControl",
  Pump: "pumpConfigurationAndControl",
  RvcRunMode: "rvcRunMode",
  RvcCleanMode: "rvcCleanMode",
  RvcOperationalState: "rvcOperationalState",
  ServiceArea: "serviceArea",
  OperationalState: "operationalState",
  OvenCavityOperationalState: "ovenCavityOperationalState",
  TemperatureControl: "temperatureControl",
  MediaPlayback: "mediaPlayback",
  MediaInput: "mediaInput",
  KeypadInput: "keypadInput",
  ApplicationLauncher: "applicationLauncher",
  CameraAvStreamManagement: "cameraAvStreamManagement",
  Switch: "switch",
  BridgedDeviceBasicInformation: "bridgedDeviceBasicInformation",
} as const;

/** Concentration measurement behaviors, each with its state key. */
export const CONCENTRATION_BEHAVIORS: ReadonlyArray<{
  behavior: string;
  measurement: ConcentrationMeasurement;
}> = [
  { behavior: "pm25ConcentrationMeasurement", measurement: "pm25" },
  { behavior: "pm10ConcentrationMeasurement", measurement: "pm10" },
  { behavior: "pm1ConcentrationMeasurement", measurement: "pm1" },
  { behavior: "carbonDioxideConcentrationMeasurement", measurement: "co2" },
  { behavior: "carbonMonoxideConcentrationMeasurement", measurement: "co" },
  { behavior: "nitrogenDioxideConcentrationMeasurement", measurement: "no2" },
  { behavior: "ozoneConcentrationMeasurement", measurement: "o3" },
  { behavior: "totalVolatileOrganicCompoundsConcentrationMeasurement", measurement: "tvoc" },
  { behavior: "formaldehydeConcentrationMeasurement", measurement: "formaldehyde" },
  { behavior: "radonConcentrationMeasurement", measurement: "radon" },
];

/** Mode behaviors Ghar drives through the `mode` capability. RVC modes belong to `rvc`. */
export const MODE_BEHAVIORS = [
  "laundryWasherMode",
  "dishwasherMode",
  "refrigeratorAndTemperatureControlledCabinetMode",
  "ovenMode",
  "microwaveOvenMode",
  "modeSelect",
] as const;

/** Concentration MeasurementUnit enum values, in order. */
const CONCENTRATION_UNITS = ["ppm", "ppb", "ppt", "mg/m3", "ug/m3", "ng/m3", "particles/m3", "Bq/m3"];

/** What an endpoint exposes, as read from its client behaviors. */
export type EndpointDescriptor = {
  /** Descriptor deviceTypeList ids, in device order. */
  deviceTypes: readonly number[];
  /** Client behavior ids present on the endpoint. */
  behaviors: readonly string[];
  /** Feature flags per behavior id. */
  features: Readonly<Record<string, Readonly<Record<string, boolean>>>>;
  /** Current attribute values per behavior id, for option lists (modes, areas, inputs, units). */
  state: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
};

/** One choice a device offers (a mode, area or input), as the API lists it. */
export type Choice = { id: number; label: string };

/**
 * Map an endpoint to its Ghar capabilities, each with the config a caller needs to
 * command it (features, ranges and option lists). Returns an empty list when the
 * endpoint has nothing Ghar reads or controls.
 */
export function deriveCapabilities(descriptor: EndpointDescriptor, kind: DeviceKind): CapabilityRecord[] {
  const has = new Set(descriptor.behaviors);
  const feature = (behavior: string, name: string) => descriptor.features[behavior]?.[name] === true;
  const state = (behavior: string): Readonly<Record<string, unknown>> => descriptor.state[behavior] ?? {};
  const out: CapabilityRecord[] = [];
  const add = (capability: GharCapability, config: Record<string, unknown> = {}) => {
    out.push({ capability, config });
  };

  if (has.has(Behavior.OnOff)) {
    add("on_off");
  }
  if (has.has(Behavior.LevelControl)) {
    add("level", { min: 0, max: 100 });
  }
  if (has.has(Behavior.ColorControl)) {
    add("color", { modes: colorModes(descriptor.features[Behavior.ColorControl]) });
  }
  if (has.has(Behavior.WindowCovering)) {
    add("cover", {
      lift: feature(Behavior.WindowCovering, "positionAwareLift"),
      tilt: feature(Behavior.WindowCovering, "positionAwareTilt"),
    });
  }
  if (has.has(Behavior.FanControl)) {
    add("fan", {
      auto: feature(Behavior.FanControl, "auto"),
      rock: feature(Behavior.FanControl, "rocking"),
      wind: feature(Behavior.FanControl, "wind"),
    });
  }
  if (has.has(Behavior.Thermostat)) {
    add("thermostat", {
      heat: feature(Behavior.Thermostat, "heating"),
      cool: feature(Behavior.Thermostat, "cooling"),
      auto: feature(Behavior.Thermostat, "autoMode"),
    });
  }
  if (has.has(Behavior.DoorLock)) {
    add("lock", { door_sensor: feature(Behavior.DoorLock, "doorPositionSensor") });
  }

  const measurements = sensorMeasurements(has, kind);
  if (measurements.length > 0) {
    const units: Record<string, string> = {};
    for (const { behavior, measurement } of CONCENTRATION_BEHAVIORS) {
      const unit = state(behavior).measurementUnit;
      const label = typeof unit === "number" ? CONCENTRATION_UNITS[unit] : undefined;
      if (has.has(behavior) && label) {
        units[measurement] = label;
      }
    }
    add("sensor", { measurements, ...(Object.keys(units).length > 0 ? { units } : {}) });
  }

  if (has.has(Behavior.Switch)) {
    const positions = state(Behavior.Switch).numberOfPositions;
    add("button", {
      positions: typeof positions === "number" ? positions : null,
      latching: feature(Behavior.Switch, "latchingSwitch"),
      multi_press: feature(Behavior.Switch, "momentarySwitchMultiPress"),
    });
  }
  if (has.has(Behavior.SmokeCoAlarm)) {
    add("alarm", {
      smoke: feature(Behavior.SmokeCoAlarm, "smokeAlarm"),
      co: feature(Behavior.SmokeCoAlarm, "coAlarm"),
    });
  }
  if (has.has(Behavior.PowerSource)) {
    add("power_source", { battery: feature(Behavior.PowerSource, "battery") });
  }
  if (has.has(Behavior.ElectricalPowerMeasurement) || has.has(Behavior.ElectricalEnergyMeasurement)) {
    add("energy", {
      power: has.has(Behavior.ElectricalPowerMeasurement),
      energy: has.has(Behavior.ElectricalEnergyMeasurement),
    });
  }
  if (has.has(Behavior.Valve)) {
    add("valve", { level: feature(Behavior.Valve, "level") });
  }
  if (has.has(Behavior.Pump)) {
    add("pump");
  }
  if (has.has(Behavior.RvcRunMode) || has.has(Behavior.RvcOperationalState)) {
    add("rvc", {
      run_modes: modeChoices(state(Behavior.RvcRunMode).supportedModes),
      clean_modes: modeChoices(state(Behavior.RvcCleanMode).supportedModes),
      areas: areaChoices(state(Behavior.ServiceArea).supportedAreas),
    });
  } else if (has.has(Behavior.OperationalState) || has.has(Behavior.OvenCavityOperationalState)) {
    add("appliance");
  }
  const modeBehavior = MODE_BEHAVIORS.find((behavior) => has.has(behavior));
  if (modeBehavior) {
    add("mode", { modes: modeChoices(state(modeBehavior).supportedModes) });
  }
  if (has.has(Behavior.TemperatureControl)) {
    const control = state(Behavior.TemperatureControl);
    add(
      "temperature_control",
      feature(Behavior.TemperatureControl, "temperatureNumber")
        ? {
            numeric: true,
            min: centi(control.minTemperature),
            max: centi(control.maxTemperature),
            step: centi(control.step),
          }
        : { numeric: false, levels: stringList(control.supportedTemperatureLevels) },
    );
  }
  if (
    has.has(Behavior.MediaPlayback) ||
    has.has(Behavior.MediaInput) ||
    has.has(Behavior.KeypadInput) ||
    has.has(Behavior.ApplicationLauncher)
  ) {
    add("media", {
      playback: has.has(Behavior.MediaPlayback),
      inputs: inputChoices(state(Behavior.MediaInput).inputList),
      keypad: has.has(Behavior.KeypadInput),
      apps: has.has(Behavior.ApplicationLauncher),
    });
  }
  if (has.has(Behavior.CameraAvStreamManagement) && feature(Behavior.CameraAvStreamManagement, "privacy")) {
    add("camera");
  }

  return out;
}

/** The measurements a sensor endpoint reports. Boolean State means what the device kind says it detects. */
function sensorMeasurements(has: ReadonlySet<string>, kind: DeviceKind): SensorMeasurement[] {
  const out: SensorMeasurement[] = [];
  if (has.has(Behavior.OccupancySensing)) {
    out.push("occupancy");
  }
  if (has.has(Behavior.TemperatureMeasurement)) {
    out.push("temperature");
  }
  if (has.has(Behavior.RelativeHumidityMeasurement)) {
    out.push("humidity");
  }
  if (has.has(Behavior.BooleanState)) {
    out.push(booleanMeasurement(kind));
  }
  if (has.has(Behavior.IlluminanceMeasurement)) {
    out.push("illuminance");
  }
  if (has.has(Behavior.PressureMeasurement)) {
    out.push("pressure");
  }
  if (has.has(Behavior.FlowMeasurement)) {
    out.push("flow");
  }
  if (has.has(Behavior.AirQuality)) {
    out.push("air_quality");
  }
  for (const { behavior, measurement } of CONCENTRATION_BEHAVIORS) {
    if (has.has(behavior)) {
      out.push(measurement);
    }
  }
  return out;
}

/** The state key for a Boolean State reading: what a leak, freeze or rain detector detects, else a contact. */
export function booleanMeasurement(kind: DeviceKind): "contact" | "leak" | "freeze" | "rain" {
  return kind === "leak" || kind === "freeze" || kind === "rain" ? kind : "contact";
}

/** Color modes from Color Control features. */
function colorModes(features: Readonly<Record<string, boolean>> | undefined): ColorMode[] {
  const modes: ColorMode[] = [];
  if (features?.hueSaturation === true) {
    modes.push("hue_sat");
  }
  if (features?.colorTemperature === true) {
    modes.push("color_temp");
  }
  return modes;
}

/** A mode cluster's supportedModes as choices. */
export function modeChoices(value: unknown): Choice[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry: unknown) =>
    isRecord(entry) && typeof entry.mode === "number" && typeof entry.label === "string"
      ? [{ id: entry.mode, label: entry.label }]
      : [],
  );
}

/** Service Area supportedAreas as choices, named by their location; an unnamed area is labeled by its id. */
export function areaChoices(value: unknown): Choice[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry: unknown) => {
    if (!isRecord(entry) || typeof entry.areaId !== "number") {
      return [];
    }
    const info = isRecord(entry.areaInfo) ? entry.areaInfo : {};
    const location = isRecord(info.locationInfo) ? info.locationInfo.locationName : undefined;
    const label = typeof location === "string" && location.length > 0 ? location : `Area ${entry.areaId}`;
    return [{ id: entry.areaId, label }];
  });
}

/** Media Input inputList as choices. */
export function inputChoices(value: unknown): Choice[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry: unknown) =>
    isRecord(entry) && typeof entry.index === "number" && typeof entry.name === "string"
      ? [{ id: entry.index, label: entry.name }]
      : [],
  );
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/** A Matter centi-unit value (0.01 °C) in whole units, or null when the device does not report it. */
function centi(value: unknown): number | null {
  return typeof value === "number" ? value / 100 : null;
}

/** True for a plain object read from a Matter attribute. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

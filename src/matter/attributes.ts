/**
 * What Ghar observes on an endpoint: each Matter attribute it caches under a Ghar state key,
 * and each cluster event it logs. Values are mapped into Ghar units (percent open, °C, kPa,
 * snake_case names); a mapper returns undefined for a value the device has not reported.
 */

import { booleanMeasurement, Behavior, CONCENTRATION_BEHAVIORS, isRecord, MODE_BEHAVIORS, type DeviceKind } from "./capabilities.js";
import { brightnessFromMatter } from "./brightness.js";

/** A behavior's current attribute values, for mappers that resolve an id against a list. */
type BehaviorState = Readonly<Record<string, unknown>>;

/** One attribute Ghar caches. `key` may depend on the device kind. */
export type ObservedAttribute = {
  behavior: string;
  attribute: string;
  key: string | ((kind: DeviceKind) => string);
  map: (value: unknown, state: BehaviorState) => unknown;
};

/** One cluster event Ghar logs. `when` limits it to endpoints whose features call for it. */
export type ObservedEvent = {
  behavior: string;
  event: string;
  key: string;
  map: (payload: unknown) => unknown;
  when?: (features: Readonly<Record<string, boolean>>) => boolean;
};

const num = (value: unknown): number | undefined =>
  typeof value === "number" ? value : typeof value === "bigint" ? Number(value) : undefined;

const bool = (value: unknown): boolean | undefined => (typeof value === "boolean" ? value : undefined);

/** Scale a Matter integer by `divisor`, rounded to two decimals. */
const scaled = (divisor: number) => (value: unknown) => {
  const n = num(value);
  return n === undefined ? undefined : Math.round((n / divisor) * 100) / 100;
};

/** Name an enum value from its ordered names; null entries are reserved values. */
const named = (names: ReadonlyArray<string | null>) => (value: unknown) => {
  const n = num(value);
  return n === undefined ? undefined : (names[n] ?? undefined);
};

/** An enum value's name, or the raw value when it is newer than the names Ghar knows. */
const nameOrValue = (names: ReadonlyArray<string | null>, value: unknown) => named(names)(value) ?? value;

/** Label of the mode whose id is `value`, from the same behavior's supportedModes. */
const modeLabel = (value: unknown, state: BehaviorState) => {
  const id = num(value);
  if (id === undefined || !Array.isArray(state.supportedModes)) {
    return undefined;
  }
  const mode = state.supportedModes.find((entry: unknown) => isRecord(entry) && entry.mode === id);
  return isRecord(mode) && typeof mode.label === "string" ? mode.label : undefined;
};

const SYSTEM_MODES = ["off", "auto", null, "cool", "heat", "emergency_heat", "precooling", "fan_only", "dry", "sleep"];
const FAN_MODES = ["off", "low", "medium", "high", "on", "auto", "smart"];
const ALARM_STATES = ["normal", "warning", "critical"];
const AIR_QUALITY = ["unknown", "good", "fair", "moderate", "poor", "very_poor", "extremely_poor"];
const VALVE_STATES = ["closed", "open", "transitioning"];
const PLAYBACK_STATES = ["playing", "paused", "not_playing", "buffering"];
const DOOR_STATES = ["open", "closed", "jammed", "forced_open", "error", "ajar"];
const LOCK_OPERATIONS = ["lock", "unlock", "non_access_user", "forced_user", "unlatch"];
const OPERATION_SOURCES = [
  "unspecified",
  "manual",
  "proprietary_remote",
  "keypad",
  "auto",
  "button",
  "schedule",
  "remote",
  "rfid",
  "biometric",
  "aliro",
];

/** Operational State values; 0x40–0x42 are the robot vacuum's own states. */
function operationalState(value: unknown): string | undefined {
  const n = num(value);
  switch (n) {
    case 0:
      return "stopped";
    case 1:
      return "running";
    case 2:
      return "paused";
    case 3:
      return "error";
    case 0x40:
      return "seeking_charger";
    case 0x41:
      return "charging";
    case 0x42:
      return "docked";
    default:
      return undefined;
  }
}

/** What a thermostat's relays are doing: heating wins over cooling, then the fan alone, else idle. */
function runningState(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (value.heat === true || value.heatStage2 === true) {
    return "heating";
  }
  if (value.cool === true || value.coolStage2 === true) {
    return "cooling";
  }
  if (value.fan === true || value.fanStage2 === true || value.fanStage3 === true) {
    return "fan";
  }
  return "idle";
}

/** Illuminance MeasuredValue is 10000·log10(lux)+1; 0 means too dark to measure. */
function lux(value: unknown): number | undefined {
  const n = num(value);
  if (n === undefined) {
    return undefined;
  }
  return n === 0 ? 0 : Math.round(10 ** ((n - 1) / 10_000));
}

/** Window Covering lift in hundredths closed, as percent open. */
function percentOpen(value: unknown): number | undefined {
  const n = num(value);
  return n === undefined ? undefined : Math.round(100 - n / 100);
}

/** Energy measurement in mWh, as kWh. */
function kwh(value: unknown): number | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const n = num(value.energy);
  return n === undefined ? undefined : Math.round(n / 10_000) / 100;
}

/** Name of the current input, from the Media Input input list. */
function inputName(value: unknown, state: BehaviorState): string | undefined {
  const index = num(value);
  if (index === undefined || !Array.isArray(state.inputList)) {
    return undefined;
  }
  const input = state.inputList.find((entry: unknown) => isRecord(entry) && entry.index === index);
  return isRecord(input) && typeof input.name === "string" ? input.name : undefined;
}

/** Name of the area the vacuum is in, from the Service Area list. */
function areaName(value: unknown, state: BehaviorState): string | undefined {
  const id = num(value);
  if (id === undefined || !Array.isArray(state.supportedAreas)) {
    return undefined;
  }
  const area = state.supportedAreas.find((entry: unknown) => isRecord(entry) && entry.areaId === id);
  if (!isRecord(area)) {
    return undefined;
  }
  const info = isRecord(area.areaInfo) ? area.areaInfo : {};
  const location = isRecord(info.locationInfo) ? info.locationInfo.locationName : undefined;
  return typeof location === "string" && location.length > 0 ? location : `Area ${id}`;
}

/** The phase name an appliance is in. */
function phaseName(value: unknown, state: BehaviorState): string | undefined {
  const index = num(value);
  if (index === undefined || !Array.isArray(state.phaseList)) {
    return undefined;
  }
  const phase: unknown = state.phaseList[index];
  return typeof phase === "string" ? phase : undefined;
}

/** The selected temperature level name. */
function temperatureLevel(value: unknown, state: BehaviorState): string | undefined {
  const index = num(value);
  if (index === undefined || !Array.isArray(state.supportedTemperatureLevels)) {
    return undefined;
  }
  const level: unknown = state.supportedTemperatureLevels[index];
  return typeof level === "string" ? level : undefined;
}

/** The application now running on a media device. */
function currentApp(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.application)) {
    return undefined;
  }
  return typeof value.application.applicationId === "string" ? value.application.applicationId : undefined;
}

const operational = (behavior: string): ObservedAttribute[] => [
  { behavior, attribute: "operationalState", key: "operational_state", map: operationalState },
  { behavior, attribute: "currentPhase", key: "phase", map: phaseName },
  { behavior, attribute: "countdownTime", key: "countdown_s", map: num },
];

/** Every attribute Ghar caches, by behavior. */
export const OBSERVED_ATTRIBUTES: readonly ObservedAttribute[] = [
  { behavior: Behavior.OnOff, attribute: "onOff", key: "on", map: bool },
  {
    behavior: Behavior.LevelControl,
    attribute: "currentLevel",
    key: (kind) => (kind === "speaker" || kind === "tv" ? "volume" : "brightness"),
    map: (value) => {
      const n = num(value);
      return n === undefined ? undefined : brightnessFromMatter(n);
    },
  },
  { behavior: Behavior.ColorControl, attribute: "colorTemperatureMireds", key: "color_temp", map: num },
  { behavior: Behavior.ColorControl, attribute: "currentHue", key: "hue", map: num },
  { behavior: Behavior.ColorControl, attribute: "currentSaturation", key: "saturation", map: num },
  { behavior: Behavior.ColorControl, attribute: "colorMode", key: "color_mode", map: named(["hue_sat", "xy", "color_temp"]) },
  { behavior: Behavior.WindowCovering, attribute: "currentPositionLiftPercent100ths", key: "open_percent", map: percentOpen },
  { behavior: Behavior.WindowCovering, attribute: "currentPositionTiltPercent100ths", key: "tilt_percent", map: scaled(100) },
  {
    behavior: Behavior.WindowCovering,
    attribute: "operationalStatus",
    key: "moving",
    map: (value) => (isRecord(value) ? num(value.global) !== 0 : undefined),
  },
  { behavior: Behavior.FanControl, attribute: "fanMode", key: "fan_mode", map: named(FAN_MODES) },
  { behavior: Behavior.FanControl, attribute: "percentCurrent", key: "fan_percent", map: num },
  { behavior: Behavior.Thermostat, attribute: "localTemperature", key: "temperature", map: scaled(100) },
  { behavior: Behavior.Thermostat, attribute: "occupiedHeatingSetpoint", key: "heat_setpoint", map: scaled(100) },
  { behavior: Behavior.Thermostat, attribute: "occupiedCoolingSetpoint", key: "cool_setpoint", map: scaled(100) },
  { behavior: Behavior.Thermostat, attribute: "systemMode", key: "system_mode", map: named(SYSTEM_MODES) },
  { behavior: Behavior.Thermostat, attribute: "thermostatRunningState", key: "running", map: runningState },
  {
    behavior: Behavior.DoorLock,
    attribute: "lockState",
    key: "locked",
    map: (value) => {
      const n = num(value);
      return n === undefined ? undefined : n === 1;
    },
  },
  { behavior: Behavior.DoorLock, attribute: "doorState", key: "door_state", map: named(DOOR_STATES) },
  { behavior: Behavior.BooleanState, attribute: "stateValue", key: booleanMeasurement, map: bool },
  {
    behavior: Behavior.OccupancySensing,
    attribute: "occupancy",
    key: "occupancy",
    map: (value) => (isRecord(value) ? value.occupied === true : undefined),
  },
  { behavior: Behavior.TemperatureMeasurement, attribute: "measuredValue", key: "temperature", map: scaled(100) },
  { behavior: Behavior.RelativeHumidityMeasurement, attribute: "measuredValue", key: "humidity", map: scaled(100) },
  { behavior: Behavior.IlluminanceMeasurement, attribute: "measuredValue", key: "illuminance", map: lux },
  { behavior: Behavior.PressureMeasurement, attribute: "measuredValue", key: "pressure", map: scaled(10) },
  { behavior: Behavior.FlowMeasurement, attribute: "measuredValue", key: "flow", map: scaled(10) },
  { behavior: Behavior.AirQuality, attribute: "airQuality", key: "air_quality", map: named(AIR_QUALITY) },
  ...CONCENTRATION_BEHAVIORS.map(
    ({ behavior, measurement }): ObservedAttribute => ({
      behavior,
      attribute: "measuredValue",
      key: measurement,
      map: (value) => {
        const n = num(value);
        return n === undefined ? undefined : Math.round(n * 100) / 100;
      },
    }),
  ),
  { behavior: Behavior.SmokeCoAlarm, attribute: "smokeState", key: "smoke_state", map: named(ALARM_STATES) },
  { behavior: Behavior.SmokeCoAlarm, attribute: "coState", key: "co_state", map: named(ALARM_STATES) },
  { behavior: Behavior.SmokeCoAlarm, attribute: "testInProgress", key: "testing", map: bool },
  {
    behavior: Behavior.PowerSource,
    attribute: "batPercentRemaining",
    key: "battery",
    map: (value) => {
      const n = num(value);
      return n === undefined ? undefined : Math.round(n / 2);
    },
  },
  { behavior: Behavior.ElectricalPowerMeasurement, attribute: "activePower", key: "power_w", map: scaled(1000) },
  { behavior: Behavior.ElectricalPowerMeasurement, attribute: "voltage", key: "voltage_v", map: scaled(1000) },
  { behavior: Behavior.ElectricalPowerMeasurement, attribute: "activeCurrent", key: "current_a", map: scaled(1000) },
  { behavior: Behavior.ElectricalEnergyMeasurement, attribute: "cumulativeEnergyImported", key: "energy_kwh", map: kwh },
  { behavior: Behavior.Valve, attribute: "currentState", key: "valve", map: named(VALVE_STATES) },
  { behavior: Behavior.Valve, attribute: "remainingDuration", key: "open_remaining_s", map: num },
  { behavior: Behavior.Valve, attribute: "currentLevel", key: "valve_level", map: num },
  { behavior: Behavior.RvcRunMode, attribute: "currentMode", key: "run_mode", map: modeLabel },
  { behavior: Behavior.RvcCleanMode, attribute: "currentMode", key: "clean_mode", map: modeLabel },
  ...operational(Behavior.RvcOperationalState),
  { behavior: Behavior.ServiceArea, attribute: "currentArea", key: "area", map: areaName },
  ...operational(Behavior.OperationalState),
  ...operational(Behavior.OvenCavityOperationalState),
  ...MODE_BEHAVIORS.map(
    (behavior): ObservedAttribute => ({ behavior, attribute: "currentMode", key: "mode", map: modeLabel }),
  ),
  { behavior: Behavior.TemperatureControl, attribute: "temperatureSetpoint", key: "target_temperature", map: scaled(100) },
  { behavior: Behavior.TemperatureControl, attribute: "selectedTemperatureLevel", key: "temperature_level", map: temperatureLevel },
  { behavior: Behavior.MediaPlayback, attribute: "currentState", key: "playback", map: named(PLAYBACK_STATES) },
  { behavior: Behavior.MediaInput, attribute: "currentInput", key: "input", map: inputName },
  { behavior: Behavior.ApplicationLauncher, attribute: "currentApp", key: "app", map: currentApp },
  { behavior: Behavior.CameraAvStreamManagement, attribute: "softLivestreamPrivacyModeEnabled", key: "privacy", map: bool },
  { behavior: Behavior.CameraAvStreamManagement, attribute: "hardPrivacyModeOn", key: "hard_privacy", map: bool },
  { behavior: Behavior.Switch, attribute: "currentPosition", key: "position", map: num },
  { behavior: Behavior.BridgedDeviceBasicInformation, attribute: "reachable", key: "reachable", map: bool },
];

/** A button press as Ghar logs it under the `button` key. */
const press = (action: string, positionField: string) => (payload: unknown) => {
  if (!isRecord(payload)) {
    return undefined;
  }
  const position = num(payload[positionField]);
  const count = num(payload.totalNumberOfPressesCounted);
  return { action, ...(position !== undefined ? { position } : {}), ...(count !== undefined ? { count } : {}) };
};

/** Every cluster event Ghar logs. */
export const OBSERVED_EVENTS: readonly ObservedEvent[] = [
  {
    behavior: Behavior.Switch,
    event: "shortRelease",
    key: "button",
    map: press("press", "previousPosition"),
    when: (features) => features.momentarySwitchMultiPress !== true,
  },
  {
    behavior: Behavior.Switch,
    event: "multiPressComplete",
    key: "button",
    map: press("multi_press", "previousPosition"),
    when: (features) => features.momentarySwitchMultiPress === true,
  },
  { behavior: Behavior.Switch, event: "longPress", key: "button", map: press("long_press", "newPosition") },
  { behavior: Behavior.Switch, event: "switchLatched", key: "button", map: press("latched", "newPosition") },
  {
    behavior: Behavior.DoorLock,
    event: "lockOperation",
    key: "lock_operation",
    map: (payload) =>
      isRecord(payload)
        ? {
            operation: nameOrValue(LOCK_OPERATIONS, payload.lockOperationType),
            source: nameOrValue(OPERATION_SOURCES, payload.operationSource),
          }
        : undefined,
  },
];

/** Resolve an observed attribute's state key for a device kind. */
export function stateKey(entry: ObservedAttribute, kind: DeviceKind): string {
  return typeof entry.key === "string" ? entry.key : entry.key(kind);
}

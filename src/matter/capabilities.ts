/**
 * Derive Ghar capabilities from an endpoint's Matter server cluster list.
 * Pure: no I/O, no Matter runtime.
 */

/** Matter cluster ids used for capability derivation. */
export const ClusterId = {
  OnOff: 0x0006,
  LevelControl: 0x0008,
  ColorControl: 0x0300,
  OccupancySensing: 0x0406,
  TemperatureMeasurement: 0x0402,
  RelativeHumidityMeasurement: 0x0405,
  BooleanState: 0x0045,
  DoorLock: 0x0101,
  Thermostat: 0x0201,
  MediaPlayback: 0x0506,
  ApplicationLauncher: 0x050c,
  KeypadInput: 0x0509,
} as const;

export type GharCapability =
  | "switchable"
  | "dimmable"
  | "colorable"
  | "sensor"
  | "lockable"
  | "media"
  | "thermostat";

export type SensorMeasurement = "occupancy" | "temperature" | "humidity" | "contact";

export type ColorMode = "hue_sat" | "color_temp";

export type CapabilityRecord = {
  capability: GharCapability;
  config: Record<string, unknown>;
};

export type EndpointDescriptor = {
  /** Matter endpoint number. */
  endpoint: number;
  /** Descriptor Cluster serverList values. */
  serverList: readonly number[];
  /**
   * Color Control feature hints when known.
   * When omitted and Color Control is present, both modes are advertised.
   */
  colorFeatures?: {
    hueSaturation?: boolean;
    colorTemperature?: boolean;
  };
};

const SENSOR_CLUSTERS: ReadonlyArray<{ id: number; measurement: SensorMeasurement }> = [
  { id: ClusterId.OccupancySensing, measurement: "occupancy" },
  { id: ClusterId.TemperatureMeasurement, measurement: "temperature" },
  { id: ClusterId.RelativeHumidityMeasurement, measurement: "humidity" },
  { id: ClusterId.BooleanState, measurement: "contact" },
];

const MEDIA_CLUSTERS = [
  ClusterId.MediaPlayback,
  ClusterId.ApplicationLauncher,
  ClusterId.KeypadInput,
] as const;

/**
 * Map an endpoint's server clusters to Ghar capabilities.
 * Returns an empty list when the endpoint has nothing agent-controllable.
 */
export function deriveCapabilities(descriptor: EndpointDescriptor): CapabilityRecord[] {
  const servers = new Set(descriptor.serverList.map((id) => Number(id)));
  const out: CapabilityRecord[] = [];

  if (servers.has(ClusterId.OnOff)) {
    out.push({ capability: "switchable", config: {} });
  }

  if (servers.has(ClusterId.LevelControl)) {
    out.push({ capability: "dimmable", config: { min: 0, max: 100 } });
  }

  if (servers.has(ClusterId.ColorControl)) {
    const modes = colorModesFromFeatures(descriptor.colorFeatures);
    out.push({ capability: "colorable", config: { modes } });
  }

  const measurements = SENSOR_CLUSTERS.filter((c) => servers.has(c.id)).map((c) => c.measurement);
  if (measurements.length > 0) {
    out.push({ capability: "sensor", config: { measurements } });
  }

  if (servers.has(ClusterId.DoorLock)) {
    out.push({ capability: "lockable", config: {} });
  }

  if (servers.has(ClusterId.Thermostat)) {
    out.push({ capability: "thermostat", config: {} });
  }

  if (MEDIA_CLUSTERS.some((id) => servers.has(id))) {
    out.push({ capability: "media", config: {} });
  }

  return out;
}

function colorModesFromFeatures(features: EndpointDescriptor["colorFeatures"]): ColorMode[] {
  if (!features) {
    return ["hue_sat", "color_temp"];
  }
  const hue = features.hueSaturation === true;
  const temp = features.colorTemperature === true;
  if (!hue && !temp) {
    return ["hue_sat", "color_temp"];
  }
  const modes: ColorMode[] = [];
  if (hue) {
    modes.push("hue_sat");
  }
  if (temp) {
    modes.push("color_temp");
  }
  return modes;
}

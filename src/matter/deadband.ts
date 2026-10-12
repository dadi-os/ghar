/**
 * Deadband filtering for numeric sensor/control values so tiny drifts do not
 * flood event_logs.
 */

/** Per-attribute absolute thresholds in Ghar units. */
export const DEADBAND: Readonly<Record<string, number>> = {
  temperature: 0.3,
  humidity: 1,
  brightness: 1,
  color_temp: 5,
  hue: 2,
  saturation: 2,
  volume: 1,
  open_percent: 1,
  tilt_percent: 1,
  fan_percent: 1,
  heat_setpoint: 0.1,
  cool_setpoint: 0.1,
  target_temperature: 0.1,
  illuminance: 20,
  pressure: 0.2,
  flow: 0.1,
  pm25: 1,
  pm10: 1,
  pm1: 1,
  co2: 25,
  co: 1,
  no2: 5,
  o3: 5,
  tvoc: 25,
  formaldehyde: 5,
  radon: 5,
  battery: 1,
  power_w: 5,
  voltage_v: 2,
  current_a: 0.05,
  energy_kwh: 0.01,
  countdown_s: 60,
  open_remaining_s: 60,
};

/**
 * Whether a value change is significant enough to write an event_logs row.
 * Non-numeric values always count as a change when unequal. Numeric values
 * at or below the deadband (plus a float epsilon) are ignored.
 */
export function isSignificantChange(attributeKey: string, oldValue: unknown, newValue: unknown): boolean {
  if (Object.is(oldValue, newValue)) {
    return false;
  }
  if (typeof oldValue === "number" && typeof newValue === "number") {
    const threshold = DEADBAND[attributeKey];
    if (threshold === undefined) {
      return oldValue !== newValue;
    }
    return Math.abs(newValue - oldValue) > threshold + 1e-9;
  }
  return oldValue !== newValue;
}

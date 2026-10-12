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

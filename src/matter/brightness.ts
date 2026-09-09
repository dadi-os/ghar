/**
 * Matter Level Control is 0–254. Ghar brightness is 0–100.
 * Convert only at this boundary.
 */

const MATTER_MAX = 254;
const GHAR_MAX = 100;

/** Convert a Ghar brightness percent (0–100) to Matter Level Control (0–254). */
export function brightnessToMatter(percent: number): number {
  if (!Number.isFinite(percent)) {
    throw new Error(`invalid brightness percent: ${percent}`);
  }
  const clamped = Math.min(GHAR_MAX, Math.max(0, percent));
  return Math.round((clamped * MATTER_MAX) / GHAR_MAX);
}

/** Convert a Matter Level Control value (0–254) to Ghar brightness percent (0–100). */
export function brightnessFromMatter(level: number): number {
  if (!Number.isFinite(level)) {
    throw new Error(`invalid Matter level: ${level}`);
  }
  const clamped = Math.min(MATTER_MAX, Math.max(0, level));
  return Math.round((clamped * GHAR_MAX) / MATTER_MAX);
}

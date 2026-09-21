/**
 * Injectable Matter fabric surface used by HTTP routes.
 * Tests decorate a fake instead of a live fabric.
 */

import type { CommissionJob } from "./commissioning.js";
import type { ColorCommand, CommandIssuer } from "./commands.js";
import type { RadioCommand, RadioEvent } from "./radio.js";
import type { StateCache } from "./state-cache.js";

/** Where discovery runs. `nearby` uses the attached Hath Bluetooth radio. */
export type CommissionRadio = "network" | "nearby";

/** Wi-Fi credentials sent to the device during nearby commissioning. Not stored. */
export type CommissionWifi = {
  ssid: string;
  password: string;
};

/** One commissioning attempt. `wifi` is held only for the in-flight job. */
export type CommissionRequest = {
  code: string;
  roomId?: string;
  radio: CommissionRadio;
  wifi?: CommissionWifi;
};

export type MatterController = {
  readonly cache: StateCache;
  getState(deviceId: string): ReadonlyMap<string, { value: unknown; changedAt: Date }> | undefined;
  /** Snapshot of every cached device attribute map. */
  getAllState(): Map<string, ReadonlyMap<string, { value: unknown; changedAt: Date }>>;
  setOn(deviceId: string, on: boolean, issuer: CommandIssuer): Promise<void>;
  setBrightness(deviceId: string, percent: number, issuer: CommandIssuer): Promise<void>;
  setColor(deviceId: string, color: ColorCommand, issuer: CommandIssuer): Promise<void>;
  /** Blink the device through the Identify cluster. */
  identify(deviceId: string): Promise<void>;
  /** Write the Matter node label. The registry name is updated by the route. */
  setLabel(deviceId: string, name: string): Promise<void>;
  /**
   * Remove a device from the fabric (when it is the last endpoint on its node)
   * and delete its registry row.
   */
  removeDevice(deviceId: string): Promise<void>;
  startCommission(request: CommissionRequest): CommissionJob;
  getCommissionJob(id: string): CommissionJob | undefined;
  /** True while a Hath client holds the Bluetooth radio session. */
  radioAttached(): boolean;
  /** Open the only radio session. */
  attachRadio(): { session_id: string };
  /** Drop the radio session. */
  detachRadio(sessionId: string): void;
  /** Next GATT or scan command, or null when `waitMs` elapses. */
  pollRadio(sessionId: string, waitMs: number): Promise<RadioCommand | null>;
  /** Complete a command the radio finished. */
  replyRadio(sessionId: string, id: number, ok: boolean, result: unknown, error?: string): void;
  /** Forward an advertisement, notification, or disconnect. */
  emitRadio(sessionId: string, event: RadioEvent): void;
};

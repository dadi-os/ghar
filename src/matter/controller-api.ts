/**
 * Injectable Matter fabric surface used by HTTP routes.
 * Tests decorate a fake instead of a live fabric.
 */

import type { CommissionJob } from "./commissioning.js";
import type { ColorCommand, CommandIssuer } from "./commands.js";
import type { StateCache } from "./state-cache.js";

export type MatterController = {
  readonly cache: StateCache;
  getState(deviceId: string): ReadonlyMap<string, { value: unknown; changedAt: Date }> | undefined;
  /** Snapshot of every cached device attribute map. */
  getAllState(): Map<string, ReadonlyMap<string, { value: unknown; changedAt: Date }>>;
  setOn(deviceId: string, on: boolean, issuer: CommandIssuer): Promise<void>;
  setBrightness(deviceId: string, percent: number, issuer: CommandIssuer): Promise<void>;
  setColor(deviceId: string, color: ColorCommand, issuer: CommandIssuer): Promise<void>;
  /**
   * Remove a device from the fabric (when it is the last endpoint on its node)
   * and delete its registry row.
   */
  removeDevice(deviceId: string): Promise<void>;
  startCommission(pairingCode: string): CommissionJob;
  getCommissionJob(id: string): CommissionJob | undefined;
};

/** Fake MatterController for Fastify inject tests (no fabric). */

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { PENDING_CAUSE_TTL_MS } from "../src/constants.js";
import type { Db } from "../src/db/client.js";
import { deviceCapabilities, devices, rooms } from "../src/db/schema.js";
import { GharError } from "../src/errors.js";
import type { MatterController } from "../src/matter/controller-api.js";
import { PendingCauseTracker } from "../src/matter/cause.js";
import type { CommissionJob } from "../src/matter/commissioning.js";
import type { ColorCommand, CommandIssuer } from "../src/matter/commands.js";
import { applyObservation } from "../src/matter/events.js";
import { StateCache } from "../src/matter/state-cache.js";
import { DeviceTimeoutError } from "../src/matter/timeout.js";
import { createLogger } from "../src/logging.js";

export type FakeCommissionMode = "succeed" | "fail-late" | "slow-succeed";

export class FakeController implements MatterController {
  readonly cache = new StateCache();
  readonly causes = new PendingCauseTracker({ ttlMs: PENDING_CAUSE_TTL_MS });
  readonly commands: Array<{ kind: string; deviceId: string; args: unknown; issuer: CommandIssuer }> =
    [];
  commissionMode: FakeCommissionMode = "succeed";
  unreachable = false;
  readonly #jobs = new Map<string, CommissionJob>();
  readonly #db: Db;
  readonly #log = createLogger();

  constructor(db: Db) {
    this.#db = db;
  }

  getState(deviceId: string) {
    return this.cache.getDevice(deviceId);
  }

  getAllState() {
    return this.cache.snapshot();
  }

  async setOn(deviceId: string, on: boolean, issuer: CommandIssuer): Promise<void> {
    this.commands.push({ kind: "on", deviceId, args: { on }, issuer });
    await this.#dispatch(deviceId, "on", on, issuer);
  }

  async setBrightness(deviceId: string, percent: number, issuer: CommandIssuer): Promise<void> {
    this.commands.push({ kind: "brightness", deviceId, args: { percent }, issuer });
    await this.#dispatch(deviceId, "brightness", percent, issuer);
  }

  async setColor(deviceId: string, color: ColorCommand, issuer: CommandIssuer): Promise<void> {
    this.commands.push({ kind: "color", deviceId, args: color, issuer });
    if ("colorTempMireds" in color) {
      await this.#dispatch(deviceId, "color_temp", color.colorTempMireds, issuer);
    } else {
      await this.#dispatch(deviceId, "hue", color.hue, issuer);
      await this.#dispatch(deviceId, "saturation", color.saturation, issuer);
    }
  }

  async removeDevice(deviceId: string): Promise<void> {
    const rows = await this.#db.select().from(devices).where(eq(devices.id, deviceId));
    if (!rows[0]) {
      throw new GharError(404, "not_found", "device not found");
    }
    await this.#db.delete(devices).where(eq(devices.id, deviceId));
    this.cache.deleteDevice(deviceId);
  }

  startCommission(pairingCode: string): CommissionJob {
    if (pairingCode === "conflict") {
      throw new GharError(409, "conflict", "node and endpoint pair already exists");
    }
    const job: CommissionJob = {
      id: randomUUID(),
      status: "pending",
      pairingCode,
      startedAt: new Date(),
    };
    this.#jobs.set(job.id, job);
    void this.#runCommission(job);
    return job;
  }

  getCommissionJob(id: string): CommissionJob | undefined {
    return this.#jobs.get(id);
  }

  /** Seed cache without writing events (boot-like). */
  seedState(deviceId: string, attributeKey: string, value: unknown): void {
    this.cache.set(deviceId, attributeKey, value, { touchChangedAt: true });
  }

  async #dispatch(
    deviceId: string,
    attributeKey: string,
    value: unknown,
    issuer: CommandIssuer,
  ): Promise<void> {
    if (this.unreachable) {
      throw new DeviceTimeoutError(`command(${deviceId})`, 5000);
    }
    this.causes.note(deviceId, attributeKey, issuer.cause, issuer.causeRef);
    // Ensure prior value exists so applyObservation writes an event.
    if (this.cache.get(deviceId, attributeKey) === undefined) {
      const seedValue = attributeKey === "on" ? !value : typeof value === "number" ? value - 1 : null;
      this.cache.set(deviceId, attributeKey, seedValue, { touchChangedAt: true });
    }
    await applyObservation(
      { db: this.#db, cache: this.cache, causes: this.causes, log: this.#log },
      { deviceId, attributeKey, value },
    );
  }

  async #runCommission(job: CommissionJob): Promise<void> {
    job.status = "discovering";
    await delay(20);
    job.status = "commissioning";
    if (this.commissionMode === "slow-succeed") {
      await delay(80);
    }
    if (this.commissionMode === "fail-late") {
      await delay(40);
      job.status = "failed";
      job.error = "attestation rejected";
      job.finishedAt = new Date();
      return;
    }
    const roomRows = await this.#db.select().from(rooms).where(eq(rooms.name, "unassigned"));
    const room = roomRows[0];
    if (!room) {
      job.status = "failed";
      job.error = "unassigned room missing";
      job.finishedAt = new Date();
      return;
    }
    const nodeId = BigInt(Date.now());
    const inserted = await this.#db
      .insert(devices)
      .values({
        nodeId,
        endpoint: 1,
        name: `commissioned-${job.id.slice(0, 8)}`,
        roomId: room.id,
        online: true,
        vendorName: "FakeVendor",
        productName: "FakeBulb",
      })
      .returning();
    const device = inserted[0];
    if (!device) {
      job.status = "failed";
      job.error = "device insert failed";
      job.finishedAt = new Date();
      return;
    }
    await this.#db.insert(deviceCapabilities).values([
      { deviceId: device.id, capability: "switchable", config: {} },
      { deviceId: device.id, capability: "dimmable", config: { min: 0, max: 100 } },
    ]);
    this.seedState(device.id, "on", false);
    this.seedState(device.id, "brightness", 100);
    job.nodeId = nodeId.toString();
    job.deviceIds = [device.id];
    job.status = "succeeded";
    job.finishedAt = new Date();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

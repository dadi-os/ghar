/**
 * Asynchronous commissioning jobs with observable status.
 * Prompt 03 exposes these over HTTP without holding the request open.
 */

import { randomUUID } from "node:crypto";
import { Seconds } from "@matter/general";
import type { ClientNode, ServerNode } from "@matter/main";
import { GeneralCommissioning } from "@matter/main/clusters";
import type { Logger } from "../logging.js";
import type { CommissionRequest, CommissionWifi } from "./controller-api.js";
import { decodePairingCode } from "./pairing.js";
import type { RegisteredDevice } from "./registry.js";
import { syncNodeToRegistry } from "./registry.js";
import type { Db } from "../db/client.js";
import { bindEndpointSubscriptions } from "./subscriptions.js";
import type { PendingCauseTracker } from "./cause.js";
import type { StateCache } from "./state-cache.js";

export type CommissionStatus =
  | "pending"
  | "discovering"
  | "commissioning"
  | "succeeded"
  | "failed";

export type CommissionJob = {
  id: string;
  status: CommissionStatus;
  pairingCode: string;
  error?: string;
  nodeId?: string;
  deviceIds?: string[];
  /** Room chosen at commission time. Omitted leaves new devices unassigned. */
  roomId?: string;
  radio: CommissionRequest["radio"];
  startedAt: Date;
  finishedAt?: Date;
};

type CommissionRuntime = {
  controller: ServerNode;
  db: Db;
  cache: StateCache;
  causes: PendingCauseTracker;
  log: Logger;
  onNodeReady: (node: ClientNode, devices: RegisteredDevice[], dispose: () => void) => void;
};

/** In-memory commission job registry. */
export class CommissioningService {
  readonly #jobs = new Map<string, CommissionJob>();
  readonly #runtime: CommissionRuntime;

  constructor(runtime: CommissionRuntime) {
    this.#runtime = runtime;
  }

  get(id: string): CommissionJob | undefined {
    return this.#jobs.get(id);
  }

  list(): CommissionJob[] {
    return [...this.#jobs.values()];
  }

  /**
   * Start commissioning from a manual or QR pairing code.
   * Returns immediately with a pending job; progress is visible via {@link get}.
   * `wifi` is used for the nearby path and is not retained on the job.
   */
  start(request: CommissionRequest): CommissionJob {
    const job: CommissionJob = {
      id: randomUUID(),
      status: "pending",
      pairingCode: request.code,
      radio: request.radio,
      startedAt: new Date(),
      ...(request.roomId !== undefined ? { roomId: request.roomId } : {}),
    };
    this.#jobs.set(job.id, job);
    void this.#run(job, request.wifi);
    return job;
  }

  async #run(job: CommissionJob, wifi: CommissionWifi | undefined): Promise<void> {
    const { controller, db, cache, causes, log, onNodeReady } = this.#runtime;
    try {
      job.status = "discovering";
      const decoded = decodePairingCode(job.pairingCode);
      log.info("commissioning discovery started", {
        job_id: job.id,
        radio: job.radio,
        room_id: job.roomId,
        short_discriminator: decoded.shortDiscriminator,
        long_discriminator: decoded.longDiscriminator,
      });

      const identifier =
        decoded.longDiscriminator !== undefined
          ? { discriminator: decoded.longDiscriminator }
          : decoded.shortDiscriminator !== undefined
            ? { shortDiscriminator: decoded.shortDiscriminator }
            : {};

      const nearby = job.radio === "nearby";
      job.status = "commissioning";
      const node = await controller.peers.commission({
        passcode: decoded.passcode,
        ...identifier,
        ...(decoded.vendorId !== undefined ? { vendorId: decoded.vendorId } : {}),
        ...(decoded.productId !== undefined ? { productId: decoded.productId } : {}),
        regulatoryLocation: GeneralCommissioning.RegulatoryLocationType.Indoor,
        regulatoryCountryCode: "US",
        discoveryCapabilities: { ble: nearby, onIpNetwork: !nearby },
        ...(wifi
          ? { wifiNetwork: { wifiSsid: wifi.ssid, wifiCredentials: wifi.password } }
          : {}),
        ...(nearby ? { timeout: Seconds(90) } : {}),
        autoSubscribe: true,
      });

      const peerAddress = node.peerAddress;
      if (!peerAddress) {
        throw new Error("commissioning completed without peer address");
      }
      job.nodeId = peerAddress.nodeId.toString();
      log.info("commissioning session established", {
        job_id: job.id,
        node_id: job.nodeId,
      });

      if (!node.lifecycle.isReady) {
        await node.lifecycle.ready;
      }

      const devices = await syncNodeToRegistry(db, node, log, job.roomId);
      const dispose = await bindEndpointSubscriptions({ db, cache, causes, log }, node, devices);
      onNodeReady(node, devices, dispose);

      job.deviceIds = devices.map((d) => d.id);
      job.status = "succeeded";
      job.finishedAt = new Date();
      log.info("commissioning succeeded", {
        job_id: job.id,
        node_id: job.nodeId,
        device_ids: job.deviceIds,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      job.status = "failed";
      job.error = message;
      job.finishedAt = new Date();
      log.error("commissioning failed", {
        job_id: job.id,
        code: "commissioning_failed",
        err: message,
      });
    }
  }
}

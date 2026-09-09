/**
 * Asynchronous commissioning jobs with observable status.
 * Prompt 03 exposes these over HTTP without holding the request open.
 */

import { randomUUID } from "node:crypto";
import type { ClientNode, ServerNode } from "@matter/main";
import { GeneralCommissioning } from "@matter/main/clusters";
import type { Logger } from "../logging.js";
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
   * Start on-network commissioning from a manual or QR pairing code.
   * Returns immediately with a pending job; progress is visible via {@link get}.
   */
  start(pairingCode: string): CommissionJob {
    const job: CommissionJob = {
      id: randomUUID(),
      status: "pending",
      pairingCode,
      startedAt: new Date(),
    };
    this.#jobs.set(job.id, job);
    void this.#run(job);
    return job;
  }

  async #run(job: CommissionJob): Promise<void> {
    const { controller, db, cache, causes, log, onNodeReady } = this.#runtime;
    try {
      job.status = "discovering";
      const decoded = decodePairingCode(job.pairingCode);
      log.info("commissioning discovery started", {
        job_id: job.id,
        short_discriminator: decoded.shortDiscriminator,
        long_discriminator: decoded.longDiscriminator,
      });

      const identifier =
        decoded.longDiscriminator !== undefined
          ? { discriminator: decoded.longDiscriminator }
          : decoded.shortDiscriminator !== undefined
            ? { shortDiscriminator: decoded.shortDiscriminator }
            : {};

      job.status = "commissioning";
      const node = await controller.peers.commission({
        passcode: decoded.passcode,
        ...identifier,
        ...(decoded.vendorId !== undefined ? { vendorId: decoded.vendorId } : {}),
        ...(decoded.productId !== undefined ? { productId: decoded.productId } : {}),
        regulatoryLocation: GeneralCommissioning.RegulatoryLocationType.Indoor,
        regulatoryCountryCode: "US",
        discoveryCapabilities: { ble: false, onIpNetwork: true },
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

      const devices = await syncNodeToRegistry(db, node, log);
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

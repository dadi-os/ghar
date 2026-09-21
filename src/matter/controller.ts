/**
 * Matter fabric controller: storage, reconnect, commissioning, state cache.
 */

import { mkdirSync } from "node:fs";
import {
  ControllerBehavior,
  Environment,
  Logger as MatterLogger,
  LogLevel,
  NetworkClient,
  ServerNode,
  type ClientNode,
} from "@matter/main";
import { Ble } from "@matter/protocol";
import { eq } from "drizzle-orm";
import { ADMIN_FABRIC_LABEL, CONTROLLER_NODE_ID, PENDING_CAUSE_TTL_MS } from "../constants.js";
import type { Db } from "../db/client.js";
import { devices } from "../db/schema.js";
import { GharError } from "../errors.js";
import type { Logger } from "../logging.js";
import type { MatterController, CommissionRequest } from "./controller-api.js";
import { PendingCauseTracker } from "./cause.js";
import { CommissioningService, type CommissionJob } from "./commissioning.js";
import {
  identifyDevice,
  setBrightness,
  setColor,
  setOnOff,
  writeDeviceLabel,
  type ColorCommand,
  type CommandIssuer,
} from "./commands.js";
import type { RegisteredDevice } from "./registry.js";
import { syncNodeToRegistry } from "./registry.js";
import { RadioHub, type RadioCommand, type RadioEvent } from "./radio.js";
import { RadioBle } from "./radio-ble.js";
import { StateCache } from "./state-cache.js";
import { bindEndpointSubscriptions } from "./subscriptions.js";
import { DeviceTimeoutError } from "./timeout.js";

export type FabricControllerOptions = {
  db: Db;
  log: Logger;
  /** Persistent Matter fabric storage directory (crown jewels). */
  matterStoragePath: string;
};

type BoundNode = {
  node: ClientNode;
  devices: RegisteredDevice[];
  dispose: () => void;
};

/**
 * Owns the Matter controller ServerNode, in-memory state cache, and commissioning jobs.
 */
export class FabricController implements MatterController {
  readonly cache = new StateCache();
  readonly causes = new PendingCauseTracker({ ttlMs: PENDING_CAUSE_TTL_MS });
  readonly #db: Db;
  readonly #log: Logger;
  readonly #matterStoragePath: string;
  readonly #bound = new Map<string, BoundNode>();
  #server: ServerNode | undefined;
  #commissioning: CommissioningService | undefined;
  #environment: Environment | undefined;
  readonly #radio = new RadioHub();

  constructor(opts: FabricControllerOptions) {
    this.#db = opts.db;
    this.#log = opts.log;
    this.#matterStoragePath = opts.matterStoragePath;
  }

  get commissioning(): CommissioningService {
    if (!this.#commissioning) {
      throw new GharError(503, "internal_error", "Matter controller is not ready");
    }
    return this.#commissioning;
  }

  get server(): ServerNode {
    if (!this.#server) {
      throw new GharError(503, "internal_error", "Matter controller is not ready");
    }
    return this.#server;
  }

  /** Start the controller, reconnect peers, and rebuild the state cache. */
  async start(): Promise<void> {
    mkdirSync(this.#matterStoragePath, { recursive: true });

    const environment = new Environment(CONTROLLER_NODE_ID, Environment.default);
    environment.vars.set("storage.path", this.#matterStoragePath);
    MatterLogger.level = LogLevel.DEBUG;
    this.#environment = environment;
    environment.set(Ble, new RadioBle(this.#radio));

    this.#log.info("matter storage ready", { path: this.#matterStoragePath });

    const server = await ServerNode.create(ServerNode.RootEndpoint.with(ControllerBehavior), {
      id: CONTROLLER_NODE_ID,
      environment,
      network: {
        ble: false,
        tcp: true,
      },
      basicInformation: {
        vendorName: ADMIN_FABRIC_LABEL,
        productName: ADMIN_FABRIC_LABEL,
      },
      controller: {
        adminFabricLabel: ADMIN_FABRIC_LABEL,
        ble: true,
      },
      commissioning: {
        enabled: false,
      },
      subscriptions: {
        persistenceEnabled: false,
      },
    });

    this.#server = server;
    this.#commissioning = new CommissioningService({
      controller: server,
      db: this.#db,
      cache: this.cache,
      causes: this.causes,
      log: this.#log,
      onNodeReady: (node, registered, dispose) => {
        this.#remember(node, registered, dispose);
      },
    });

    await server.start();
    this.#log.info("matter controller online", { fabric: ADMIN_FABRIC_LABEL });

    await this.#reconnectPeers();
  }

  async stop(): Promise<void> {
    for (const bound of this.#bound.values()) {
      bound.dispose();
    }
    this.#bound.clear();
    if (this.#server) {
      await this.#server.cancel();
      this.#server = undefined;
    }
    this.#commissioning = undefined;
    this.#environment = undefined;
  }

  /** Read cached attributes for a device. */
  getState(deviceId: string): ReadonlyMap<string, { value: unknown; changedAt: Date }> | undefined {
    return this.cache.getDevice(deviceId);
  }

  getAllState(): Map<string, ReadonlyMap<string, { value: unknown; changedAt: Date }>> {
    return this.cache.snapshot();
  }

  async setOn(deviceId: string, on: boolean, issuer: CommandIssuer): Promise<void> {
    try {
      const { node, endpoint } = await this.#resolveDevice(deviceId);
      await setOnOff(node, endpoint, deviceId, on, this.causes, issuer);
    } catch (err) {
      this.#mapCommandError(err);
    }
  }

  async setBrightness(deviceId: string, percent: number, issuer: CommandIssuer): Promise<void> {
    try {
      const { node, endpoint } = await this.#resolveDevice(deviceId);
      await setBrightness(node, endpoint, deviceId, percent, this.causes, issuer);
    } catch (err) {
      this.#mapCommandError(err);
    }
  }

  async setColor(deviceId: string, color: ColorCommand, issuer: CommandIssuer): Promise<void> {
    try {
      const { node, endpoint } = await this.#resolveDevice(deviceId);
      await setColor(node, endpoint, deviceId, color, this.causes, issuer);
    } catch (err) {
      this.#mapCommandError(err);
    }
  }

  async identify(deviceId: string): Promise<void> {
    try {
      const { node, endpoint } = await this.#resolveDevice(deviceId);
      await identifyDevice(node, endpoint);
    } catch (err) {
      this.#mapCommandError(err);
    }
  }

  async setLabel(deviceId: string, name: string): Promise<void> {
    try {
      const { node, endpoint } = await this.#resolveDevice(deviceId);
      await writeDeviceLabel(node, endpoint, name);
    } catch (err) {
      this.#mapCommandError(err);
    }
  }

  startCommission(request: CommissionRequest): CommissionJob {
    return this.commissioning.start(request);
  }

  getCommissionJob(id: string): CommissionJob | undefined {
    return this.commissioning.get(id);
  }

  radioAttached(): boolean {
    return this.#radio.attached;
  }

  attachRadio(): { session_id: string } {
    return this.#radio.attach();
  }

  detachRadio(sessionId: string): void {
    this.#radio.detach(sessionId);
  }

  pollRadio(sessionId: string, waitMs: number): Promise<RadioCommand | null> {
    return this.#radio.poll(sessionId, waitMs);
  }

  replyRadio(
    sessionId: string,
    id: number,
    ok: boolean,
    result: unknown,
    error?: string,
  ): void {
    this.#radio.reply(sessionId, id, ok, result, error);
  }

  emitRadio(sessionId: string, event: RadioEvent): void {
    this.#radio.emit(sessionId, event);
  }

  async removeDevice(deviceId: string): Promise<void> {
    const rows = await this.#db.select().from(devices).where(eq(devices.id, deviceId));
    const row = rows[0];
    if (!row) {
      throw new GharError(404, "not_found", "device not found");
    }
    const nodeKey = row.nodeId.toString();
    const siblings = await this.#db.select().from(devices).where(eq(devices.nodeId, row.nodeId));
    const lastEndpoint = siblings.length <= 1;
    const bound = this.#bound.get(nodeKey);

    await this.#db.delete(devices).where(eq(devices.id, deviceId));
    this.cache.deleteDevice(deviceId);

    if (bound) {
      bound.devices = bound.devices.filter((d) => d.id !== deviceId);
      if (lastEndpoint) {
        bound.dispose();
        this.#bound.delete(nodeKey);
        try {
          await bound.node.decommission();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.#log.warn("fabric decommission failed; force-deleting peer", {
            node_id: nodeKey,
            err: message,
          });
          await bound.node.delete().catch(() => undefined);
        }
      }
    }
  }

  #mapCommandError(err: unknown): never {
    if (err instanceof GharError) {
      throw err;
    }
    if (err instanceof DeviceTimeoutError) {
      throw new GharError(504, "device_unreachable", err.message);
    }
    const message = err instanceof Error ? err.message : String(err);
    if (/not found|no live Matter session/i.test(message)) {
      throw new GharError(404, "not_found", message);
    }
    throw new GharError(504, "device_unreachable", message);
  }

  async #reconnectPeers(): Promise<void> {
    const server = this.server;
    const peers = [...server.peers].filter((peer) => peer.lifecycle.isCommissioned);
    this.#log.info("reconnecting commissioned peers", { count: peers.length });

    for (const peer of peers) {
      const nodeId = peer.peerAddress?.nodeId.toString() ?? peer.id;
      try {
        this.#log.info("session establishment starting", { node_id: nodeId });
        if (peer.state.network?.isDisabled) {
          await peer.enable();
        }
        await peer.setStateOf(NetworkClient, { autoSubscribe: true, isDisabled: false });

        if (!peer.lifecycle.isReady) {
          await peer.lifecycle.ready;
        }

        const registered = await syncNodeToRegistry(this.#db, peer, this.#log);
        const dispose = await bindEndpointSubscriptions(
          { db: this.#db, cache: this.cache, causes: this.causes, log: this.#log },
          peer,
          registered,
        );
        this.#remember(peer, registered, dispose);
        this.#log.info("peer reconnected", {
          node_id: nodeId,
          devices: registered.length,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.#log.error("peer reconnect failed", {
          node_id: nodeId,
          code: "session_failed",
          err: message,
        });
      }
    }
  }

  #remember(node: ClientNode, registered: RegisteredDevice[], dispose: () => void): void {
    const key = node.peerAddress?.nodeId.toString() ?? String(node.id);
    const existing = this.#bound.get(key);
    if (existing) {
      existing.dispose();
    }
    this.#bound.set(key, { node, devices: registered, dispose });
  }

  async #resolveDevice(deviceId: string): Promise<{ node: ClientNode; endpoint: number }> {
    const rows = await this.#db.select().from(devices).where(eq(devices.id, deviceId));
    const row = rows[0];
    if (!row) {
      throw new Error(`device not found: ${deviceId}`);
    }
    const key = row.nodeId.toString();
    const bound = this.#bound.get(key);
    if (!bound) {
      throw new Error(`no live Matter session for node ${key}`);
    }
    return { node: bound.node, endpoint: row.endpoint };
  }
}

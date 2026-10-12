/**
 * Wire Matter attribute subscriptions and cluster events into the state cache and event log,
 * from the observed attribute and event tables.
 */

import type { ClientNode, Endpoint } from "@matter/main";
import type { Db } from "../db/client.js";
import type { Logger } from "../logging.js";
import { OBSERVED_ATTRIBUTES, OBSERVED_EVENTS, stateKey } from "./attributes.js";
import { Behavior } from "./capabilities.js";
import type { PendingCauseTracker } from "./cause.js";
import { applyEvent, applyObservation } from "./events.js";
import type { RegisteredDevice } from "./registry.js";
import type { StateCache } from "./state-cache.js";

type ObserveDeps = {
  db: Db;
  cache: StateCache;
  causes: PendingCauseTracker;
  log: Logger;
};

function deviceKey(nodeId: bigint, endpoint: number): string {
  return `${nodeId}:${endpoint}`;
}

/**
 * Seed cache from current endpoint state and attach change listeners.
 * Returns a disposer that removes listeners.
 */
export async function bindEndpointSubscriptions(
  deps: ObserveDeps,
  node: ClientNode,
  registered: RegisteredDevice[],
): Promise<() => void> {
  const peerAddress = node.peerAddress;
  if (!peerAddress) {
    return () => {};
  }
  const nodeId = BigInt(peerAddress.nodeId);
  const byEndpoint = new Map(registered.map((device) => [deviceKey(device.nodeId, device.endpoint), device]));
  const disposers: Array<() => void> = [];

  for (const endpoint of node.parts) {
    const endpointNumber = endpoint.number;
    if (endpointNumber === undefined) {
      continue;
    }
    const device = byEndpoint.get(deviceKey(nodeId, endpointNumber));
    if (!device) {
      continue;
    }
    disposers.push(...(await bindOneEndpoint(deps, node, endpoint, device)));
  }

  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}

/**
 * The endpoint a behavior is read from: the device's own endpoint, or the node's root for a
 * Power Source the device does not carry itself (a battery sensor reports it there).
 */
function sourceOf(node: ClientNode, endpoint: Endpoint, behavior: string): Endpoint | undefined {
  if (endpoint.maybeStateOf(behavior) !== undefined) {
    return endpoint;
  }
  if (behavior === Behavior.PowerSource && node.maybeStateOf(behavior) !== undefined) {
    return node;
  }
  return undefined;
}

/** A behavior's state on an endpoint Ghar already found it on. */
function behaviorState(source: Endpoint, behavior: string): Readonly<Record<string, unknown>> {
  const state = source.maybeStateOf(behavior);
  if (state === undefined) {
    throw new Error(`behavior ${behavior} disappeared from endpoint ${source.number}`);
  }
  return state;
}

async function bindOneEndpoint(
  deps: ObserveDeps,
  node: ClientNode,
  endpoint: Endpoint,
  device: RegisteredDevice,
): Promise<Array<() => void>> {
  const disposers: Array<() => void> = [];

  for (const entry of OBSERVED_ATTRIBUTES) {
    const source = sourceOf(node, endpoint, entry.behavior);
    if (!source) {
      continue;
    }
    const key = stateKey(entry, device.kind);
    const state = () => behaviorState(source, entry.behavior);
    const read = (value: unknown) => entry.map(value, state());
    const current = read(state()[entry.attribute]);
    if (current !== undefined) {
      await applyObservation(deps, { deviceId: device.id, attributeKey: key, value: current, seed: true });
    }
    const changed = source.eventsOf(entry.behavior)[`${entry.attribute}$Changed`];
    if (!changed) {
      continue;
    }
    const handler = (value: unknown) => {
      const mapped = read(value);
      if (mapped !== undefined) {
        void applyObservation(deps, { deviceId: device.id, attributeKey: key, value: mapped, seed: false });
      }
    };
    changed.on(handler);
    disposers.push(() => changed.off(handler));
  }

  for (const entry of OBSERVED_EVENTS) {
    if (endpoint.maybeStateOf(entry.behavior) === undefined) {
      continue;
    }
    if (entry.when && !entry.when(endpoint.featuresOf(entry.behavior))) {
      continue;
    }
    const occurred = endpoint.eventsOf(entry.behavior)[entry.event];
    if (!occurred) {
      continue;
    }
    const handler = (payload: unknown) => {
      const value = entry.map(payload);
      if (value !== undefined) {
        void applyEvent(deps, { deviceId: device.id, attributeKey: entry.key, value });
      }
    };
    occurred.on(handler);
    disposers.push(() => occurred.off(handler));
  }

  return disposers;
}

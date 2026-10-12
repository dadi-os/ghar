/**
 * Wire Matter attribute subscriptions into the state cache and event log.
 */

import type { ClientNode, Endpoint } from "@matter/main";
import { BooleanStateClient } from "@matter/main/behaviors/boolean-state";
import { ColorControlClient } from "@matter/main/behaviors/color-control";
import { LevelControlClient } from "@matter/main/behaviors/level-control";
import { OccupancySensingClient } from "@matter/main/behaviors/occupancy-sensing";
import { OnOffClient } from "@matter/main/behaviors/on-off";
import { RelativeHumidityMeasurementClient } from "@matter/main/behaviors/relative-humidity-measurement";
import { TemperatureMeasurementClient } from "@matter/main/behaviors/temperature-measurement";
import { DoorLockClient } from "@matter/main/behaviors/door-lock";
import type { Db } from "../db/client.js";
import type { Logger } from "../logging.js";
import { brightnessFromMatter } from "./brightness.js";
import type { PendingCauseTracker } from "./cause.js";
import { applyObservation } from "./events.js";
import type { RegisteredDevice } from "./registry.js";
import type { StateCache } from "./state-cache.js";

type ObserveDeps = {
  db: Db;
  cache: StateCache;
  causes: PendingCauseTracker;
  log: Logger;
};

type DeviceIndex = Map<string, string>; // `${nodeId}:${endpoint}` -> deviceId

function deviceKey(nodeId: bigint, endpoint: number): string {
  return `${nodeId}:${endpoint}`;
}

function indexDevices(registered: RegisteredDevice[]): DeviceIndex {
  const index: DeviceIndex = new Map();
  for (const device of registered) {
    index.set(deviceKey(device.nodeId, device.endpoint), device.id);
  }
  return index;
}

async function observe(
  deps: ObserveDeps,
  deviceId: string,
  attributeKey: string,
  value: unknown,
  seed: boolean,
): Promise<void> {
  await applyObservation(deps, { deviceId, attributeKey, value, seed });
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
  const byEndpoint = indexDevices(registered);
  const disposers: Array<() => void> = [];

  for (const endpoint of node.parts) {
    const endpointNumber = endpoint.number;
    if (endpointNumber === undefined) {
      continue;
    }
    const deviceId = byEndpoint.get(deviceKey(nodeId, endpointNumber));
    if (!deviceId) {
      continue;
    }
    disposers.push(...(await bindOneEndpoint(deps, endpoint, deviceId)));
  }

  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}

async function bindOneEndpoint(
  deps: ObserveDeps,
  endpoint: Endpoint,
  deviceId: string,
): Promise<Array<() => void>> {
  const disposers: Array<() => void> = [];

  const onOff = endpoint.maybeStateOf(OnOffClient);
  if (onOff !== undefined) {
    await observe(deps, deviceId, "on", onOff.onOff, true);
    const events = endpoint.eventsOf(OnOffClient);
    const handler = (value: boolean) => {
      void observe(deps, deviceId, "on", value, false);
    };
    events.onOff$Changed.on(handler);
    disposers.push(() => events.onOff$Changed.off(handler));
  }

  const level = endpoint.maybeStateOf(LevelControlClient);
  if (level !== undefined && level.currentLevel !== null && level.currentLevel !== undefined) {
    await observe(deps, deviceId, "brightness", brightnessFromMatter(level.currentLevel), true);
    const events = endpoint.eventsOf(LevelControlClient);
    const handler = (value: number | null) => {
      if (value === null) {
        return;
      }
      void observe(deps, deviceId, "brightness", brightnessFromMatter(value), false);
    };
    events.currentLevel$Changed.on(handler);
    disposers.push(() => events.currentLevel$Changed.off(handler));
  }

  const color = endpoint.maybeStateOf(ColorControlClient);
  if (color !== undefined) {
    if (color.colorTemperatureMireds !== undefined && color.colorTemperatureMireds !== null) {
      await observe(deps, deviceId, "color_temp", color.colorTemperatureMireds, true);
      const events = endpoint.eventsOf(ColorControlClient);
      if (events.colorTemperatureMireds$Changed) {
        const handler = (value: number | null) => {
          if (value === null) {
            return;
          }
          void observe(deps, deviceId, "color_temp", value, false);
        };
        events.colorTemperatureMireds$Changed.on(handler);
        disposers.push(() => events.colorTemperatureMireds$Changed?.off(handler));
      }
    }
    if (color.currentHue !== undefined && color.currentHue !== null) {
      await observe(deps, deviceId, "hue", color.currentHue, true);
      const events = endpoint.eventsOf(ColorControlClient);
      if (events.currentHue$Changed) {
        const handler = (value: number | null) => {
          if (value === null) {
            return;
          }
          void observe(deps, deviceId, "hue", value, false);
        };
        events.currentHue$Changed.on(handler);
        disposers.push(() => events.currentHue$Changed?.off(handler));
      }
    }
    if (color.currentSaturation !== undefined && color.currentSaturation !== null) {
      await observe(deps, deviceId, "saturation", color.currentSaturation, true);
      const events = endpoint.eventsOf(ColorControlClient);
      if (events.currentSaturation$Changed) {
        const handler = (value: number | null) => {
          if (value === null) {
            return;
          }
          void observe(deps, deviceId, "saturation", value, false);
        };
        events.currentSaturation$Changed.on(handler);
        disposers.push(() => events.currentSaturation$Changed?.off(handler));
      }
    }
  }

  const occupancy = endpoint.maybeStateOf(OccupancySensingClient);
  if (occupancy?.occupancy !== undefined) {
    const occupied = occupancy.occupancy.occupied === true;
    await observe(deps, deviceId, "occupancy", occupied, true);
    const events = endpoint.eventsOf(OccupancySensingClient);
    const handler = (value: { occupied?: boolean }) => {
      void observe(deps, deviceId, "occupancy", value.occupied === true, false);
    };
    events.occupancy$Changed.on(handler);
    disposers.push(() => events.occupancy$Changed.off(handler));
  }

  const temperature = endpoint.maybeStateOf(TemperatureMeasurementClient);
  if (temperature?.measuredValue !== undefined && temperature.measuredValue !== null) {
    const celsius = temperature.measuredValue / 100;
    await observe(deps, deviceId, "temperature", celsius, true);
    const events = endpoint.eventsOf(TemperatureMeasurementClient);
    const handler = (value: number | null) => {
      if (value === null) {
        return;
      }
      void observe(deps, deviceId, "temperature", value / 100, false);
    };
    events.measuredValue$Changed.on(handler);
    disposers.push(() => events.measuredValue$Changed.off(handler));
  }

  const humidity = endpoint.maybeStateOf(RelativeHumidityMeasurementClient);
  if (humidity?.measuredValue !== undefined && humidity.measuredValue !== null) {
    const percent = humidity.measuredValue / 100;
    await observe(deps, deviceId, "humidity", percent, true);
    const events = endpoint.eventsOf(RelativeHumidityMeasurementClient);
    const handler = (value: number | null) => {
      if (value === null) {
        return;
      }
      void observe(deps, deviceId, "humidity", value / 100, false);
    };
    events.measuredValue$Changed.on(handler);
    disposers.push(() => events.measuredValue$Changed.off(handler));
  }

  const contact = endpoint.maybeStateOf(BooleanStateClient);
  if (contact?.stateValue !== undefined) {
    await observe(deps, deviceId, "contact", contact.stateValue, true);
    const events = endpoint.eventsOf(BooleanStateClient);
    const handler = (value: boolean) => {
      void observe(deps, deviceId, "contact", value, false);
    };
    events.stateValue$Changed.on(handler);
    disposers.push(() => events.stateValue$Changed.off(handler));
  }

  const lock = endpoint.maybeStateOf(DoorLockClient);
  if (lock?.lockState !== undefined && lock.lockState !== null) {
    const locked = Number(lock.lockState) === 1;
    await observe(deps, deviceId, "locked", locked, true);
    const events = endpoint.eventsOf(DoorLockClient);
    if (events.lockState$Changed) {
      const handler = (value: typeof lock.lockState | null) => {
        if (value === null || value === undefined) {
          return;
        }
        void observe(deps, deviceId, "locked", Number(value) === 1, false);
      };
      events.lockState$Changed.on(handler);
      disposers.push(() => events.lockState$Changed?.off(handler));
    }
  }

  return disposers;
}

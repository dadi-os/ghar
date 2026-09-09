/** Write significant attribute changes to event_logs and update the state cache. */

import type { Db } from "../db/client.js";
import { eventLogs } from "../db/schema.js";
import type { Logger } from "../logging.js";
import type { PendingCauseTracker } from "./cause.js";
import { isSignificantChange } from "./deadband.js";
import type { StateCache } from "./state-cache.js";

export type AttributeObservation = {
  deviceId: string;
  attributeKey: string;
  value: unknown;
  at?: Date;
  /** When true, seed the cache without writing event_logs. */
  seed?: boolean;
};

/**
 * Apply an observed attribute value: update cache and, on significant change,
 * append an event_logs row with attributed cause.
 */
export async function applyObservation(
  deps: {
    db: Db;
    cache: StateCache;
    causes: PendingCauseTracker;
    log: Logger;
  },
  observation: AttributeObservation,
): Promise<void> {
  const at = observation.at ?? new Date();
  const previous = deps.cache.get(observation.deviceId, observation.attributeKey);

  if (observation.seed || previous === undefined) {
    deps.cache.set(observation.deviceId, observation.attributeKey, observation.value, {
      at,
      touchChangedAt: true,
    });
    return;
  }

  if (Object.is(previous.value, observation.value)) {
    return;
  }

  if (!isSignificantChange(observation.attributeKey, previous.value, observation.value)) {
    deps.cache.set(observation.deviceId, observation.attributeKey, observation.value, {
      at,
      touchChangedAt: false,
    });
    return;
  }

  deps.cache.set(observation.deviceId, observation.attributeKey, observation.value, {
    at,
    touchChangedAt: true,
  });

  const attribution = deps.causes.attribute(observation.deviceId, observation.attributeKey);
  await deps.db.insert(eventLogs).values({
    deviceId: observation.deviceId,
    attributeKey: observation.attributeKey,
    oldValue: previous.value ?? null,
    newValue: observation.value,
    cause: attribution.cause,
    causeRef: attribution.causeRef ?? null,
    createdAt: at,
  });

  deps.log.debug("event logged", {
    device_id: observation.deviceId,
    attribute: observation.attributeKey,
    cause: attribution.cause,
    cause_ref: attribution.causeRef,
  });
}

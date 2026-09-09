/** In-memory device attribute cache. Never persisted. */

export type CachedAttribute = {
  value: unknown;
  changedAt: Date;
};

export type DeviceStateSnapshot = {
  attributes: Map<string, CachedAttribute>;
};

/** Mutable in-memory map from device id to current attribute values. */
export class StateCache {
  readonly #devices = new Map<string, DeviceStateSnapshot>();

  get(deviceId: string, attributeKey: string): CachedAttribute | undefined {
    return this.#devices.get(deviceId)?.attributes.get(attributeKey);
  }

  /** All attributes for a device, or undefined if unknown. */
  getDevice(deviceId: string): ReadonlyMap<string, CachedAttribute> | undefined {
    return this.#devices.get(deviceId)?.attributes;
  }

  /**
   * Store an attribute. When `touchChangedAt` is false, refresh value only.
   * Returns the previous cached entry, if any.
   */
  set(
    deviceId: string,
    attributeKey: string,
    value: unknown,
    opts: { at?: Date; touchChangedAt?: boolean } = {},
  ): CachedAttribute | undefined {
    const at = opts.at ?? new Date();
    const touch = opts.touchChangedAt !== false;
    let device = this.#devices.get(deviceId);
    if (!device) {
      device = { attributes: new Map() };
      this.#devices.set(deviceId, device);
    }
    const prev = device.attributes.get(attributeKey);
    if (prev && Object.is(prev.value, value) && (!touch || prev.changedAt === at)) {
      return prev;
    }
    device.attributes.set(attributeKey, {
      value,
      changedAt: touch || !prev ? at : prev.changedAt,
    });
    return prev;
  }

  /** Drop cache for a device (e.g. after decommission). */
  deleteDevice(deviceId: string): void {
    this.#devices.delete(deviceId);
  }

  /** All device ids currently held in the cache. */
  deviceIds(): string[] {
    return [...this.#devices.keys()];
  }

  /** Full snapshot for GET /state. */
  snapshot(): Map<string, ReadonlyMap<string, CachedAttribute>> {
    const out = new Map<string, ReadonlyMap<string, CachedAttribute>>();
    for (const [deviceId, device] of this.#devices) {
      out.set(deviceId, new Map(device.attributes));
    }
    return out;
  }

  clear(): void {
    this.#devices.clear();
  }
}

/**
 * Short-lived map of commands Ghar issued, used to attribute subscription reports.
 */

export type EventCause = "agent" | "user" | "external";

export type PendingCommand = {
  cause: "agent" | "user";
  causeRef?: string;
  expiresAt: number;
};

export type Clock = () => number;

function defaultKey(deviceId: string, attributeKey: string): string {
  return `${deviceId}:${attributeKey}`;
}

/** Tracks recently issued commands for cause attribution. */
export class PendingCauseTracker {
  readonly #pending = new Map<string, PendingCommand>();
  readonly #now: Clock;
  readonly #ttlMs: number;

  constructor(opts: { ttlMs: number; now?: Clock }) {
    this.#ttlMs = opts.ttlMs;
    this.#now = opts.now ?? (() => Date.now());
  }

  /** Record that Ghar issued a change for device/attribute. */
  note(deviceId: string, attributeKey: string, cause: "agent" | "user", causeRef?: string): void {
    const entry: PendingCommand = {
      cause,
      expiresAt: this.#now() + this.#ttlMs,
    };
    if (causeRef !== undefined) {
      entry.causeRef = causeRef;
    }
    this.#pending.set(defaultKey(deviceId, attributeKey), entry);
  }

  /**
   * Resolve cause for an observed report. Consumes a matching pending entry.
   * Reports after expiry (or with no pending entry) are external.
   */
  attribute(
    deviceId: string,
    attributeKey: string,
  ): { cause: EventCause; causeRef?: string } {
    const key = defaultKey(deviceId, attributeKey);
    const pending = this.#pending.get(key);
    if (!pending) {
      return { cause: "external" };
    }
    this.#pending.delete(key);
    if (this.#now() > pending.expiresAt) {
      return { cause: "external" };
    }
    if (pending.causeRef !== undefined) {
      return { cause: pending.cause, causeRef: pending.causeRef };
    }
    return { cause: pending.cause };
  }
}

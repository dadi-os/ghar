/**
 * One Hath Bluetooth radio, reached over HTTP long-poll.
 * Ghar's Matter stack sends GATT commands; Hath executes them on the
 * computer that is standing next to the device.
 */

import { randomUUID } from "node:crypto";
import { GharError } from "../errors.js";

/** Command Hath runs against its local Bluetooth adapter. */
export type RadioCommandName =
  | "scan"
  | "stop_scan"
  | "connect"
  | "disconnect"
  | "write"
  | "subscribe";

/** One in-flight GATT or scan command. */
export type RadioCommand = {
  id: number;
  name: RadioCommandName;
  args: Record<string, string>;
};

/** Unsolicited bytes or a drop, posted by Hath. */
export type RadioEvent = {
  kind: "advertisement" | "notification" | "disconnected";
  address: string;
  value_b64?: string;
};

type Waiter = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type Poller = {
  resolve: (command: RadioCommand | null) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Single attached radio. A second attach is a conflict; a command with no
 * session fails immediately.
 */
export class RadioHub {
  #session: string | null = null;
  #seq = 0;
  #queue: RadioCommand[] = [];
  #poll: Poller | null = null;
  #waiters = new Map<number, Waiter>();
  #listeners = new Set<(event: RadioEvent) => void>();

  /** True while a Hath client holds the radio session. */
  get attached(): boolean {
    return this.#session !== null;
  }

  /** Open the only radio session. */
  attach(): { session_id: string } {
    if (this.#session) {
      throw new GharError(409, "conflict", "a hath radio is already attached");
    }
    this.#session = randomUUID();
    return { session_id: this.#session };
  }

  /** Drop the session and fail every command still waiting on Hath. Already released is a no-op. */
  detach(sessionId: string): void {
    if (this.#session === null) {
      return;
    }
    this.#assert(sessionId);
    this.#session = null;
    this.#failAll(new Error("radio detached"));
  }

  /**
   * Next command for this session.
   * `waitMs` 0 returns immediately when the queue is empty.
   */
  poll(sessionId: string, waitMs: number): Promise<RadioCommand | null> {
    this.#assert(sessionId);
    const next = this.#queue.shift();
    if (next) {
      return Promise.resolve(next);
    }
    if (waitMs <= 0) {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.#poll?.resolve === resolve) {
          this.#poll = null;
        }
        resolve(null);
      }, waitMs);
      this.#poll = { resolve, timer };
    });
  }

  /** Complete a command Hath finished. */
  reply(
    sessionId: string,
    id: number,
    ok: boolean,
    result: unknown,
    error?: string,
  ): void {
    this.#assert(sessionId);
    const waiter = this.#waiters.get(id);
    if (!waiter) {
      throw new GharError(404, "not_found", "radio command is not waiting");
    }
    clearTimeout(waiter.timer);
    this.#waiters.delete(id);
    if (ok) {
      waiter.resolve(result);
      return;
    }
    if (!error) {
      throw new GharError(422, "invalid_request", "a failed radio reply requires error");
    }
    waiter.reject(new Error(error));
  }

  /** Forward an advertisement, notification, or disconnect into the Matter stack. */
  emit(sessionId: string, event: RadioEvent): void {
    this.#assert(sessionId);
    for (const listener of this.#listeners) {
      listener(event);
    }
  }

  /** Subscribe to events from the attached radio. */
  subscribe(listener: (event: RadioEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Ask the attached Hath to run one command.
   * Rejects immediately when no radio is attached.
   */
  request(
    name: RadioCommandName,
    args: Record<string, string>,
    timeoutMs = 20_000,
  ): Promise<unknown> {
    if (!this.#session) {
      return Promise.reject(new Error("radio_unavailable: no hath radio is attached"));
    }
    const id = ++this.#seq;
    const command: RadioCommand = { id, name, args };
    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiters.delete(id);
        reject(new Error(`radio command timed out: ${name}`));
      }, timeoutMs);
      this.#waiters.set(id, { resolve, reject, timer });
    });
    const poll = this.#poll;
    if (poll) {
      clearTimeout(poll.timer);
      this.#poll = null;
      poll.resolve(command);
    } else {
      this.#queue.push(command);
    }
    return promise;
  }

  #assert(sessionId: string): void {
    if (!this.#session || this.#session !== sessionId) {
      throw new GharError(409, "conflict", "radio session is not active");
    }
  }

  /** Reject every command still waiting, and release a parked long-poll. */
  #failAll(err: Error): void {
    const poll = this.#poll;
    this.#poll = null;
    if (poll) {
      clearTimeout(poll.timer);
      poll.resolve(null);
    }
    this.#queue = [];
    for (const waiter of this.#waiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(err);
    }
    this.#waiters.clear();
  }
}

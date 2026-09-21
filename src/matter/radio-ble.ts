/**
 * Matter {@link Ble} whose scanner and GATT central are a Hath radio.
 * BTP stays in matter.js; only the air interface is forwarded.
 */

import {
  Bytes,
  ChannelType,
  ServerAddress,
  type Transport,
} from "@matter/general";
import {
  Ble,
  BleChannel,
  BleScanner,
  BtpCodec,
  BtpSessionHandler,
  MatterBle,
  type BlePeripheral,
  type BlePeripheralInterface,
  type BleScannerClient,
} from "@matter/protocol";
import type { RadioEvent, RadioHub } from "./radio.js";

const HANDSHAKE_MS = 15_000;
const CONNECT_MS = 45_000;

type PendingWaiter = {
  resolve: (bytes: Bytes) => void;
  reject: (err: Error) => void;
};

/**
 * Forwards Matter service-data advertisements into {@link BleScanner}.
 */
class RadioScanClient implements BleScannerClient {
  #callback: ((peripheral: BlePeripheral, data: Bytes) => void) | undefined;
  readonly #hub: RadioHub;

  constructor(hub: RadioHub) {
    this.#hub = hub;
    hub.subscribe((event) => {
      if (event.kind !== "advertisement" || !event.value_b64 || !this.#callback) {
        return;
      }
      this.#callback({ address: event.address }, Bytes.fromBase64(event.value_b64));
    });
  }

  setDiscoveryCallback(callback: (peripheral: BlePeripheral, data: Bytes) => void): void {
    this.#callback = callback;
  }

  startScanning(): Promise<void> {
    return this.#hub.request("scan", {}).then(() => undefined);
  }

  stopScanning(): Promise<void> {
    return this.#hub.request("stop_scan", {}).then(() => undefined);
  }
}

/**
 * BLE channel over one Hath GATT connection.
 * `send` is a Matter payload; the iterator yields Matter payloads after BTP.
 */
class RadioChannel extends BleChannel {
  readonly name: string;
  #queue: Bytes[] = [];
  #pending: ((result: IteratorResult<Bytes>) => void) | null = null;
  #ended = false;
  #closers: Array<() => void> = [];

  constructor(
    address: string,
    private readonly sendMatter: (data: Bytes) => Promise<void>,
    private readonly disconnect: () => Promise<void>,
  ) {
    super();
    this.name = `ble:${address}`;
  }

  /** Deliver one reassembled Matter message. */
  push(data: Bytes): void {
    if (this.#ended) {
      return;
    }
    const waiter = this.#pending;
    if (waiter) {
      this.#pending = null;
      waiter({ value: data, done: false });
      return;
    }
    this.#queue.push(data);
  }

  /** End the iterator because the peripheral dropped. */
  end(): void {
    if (this.#ended) {
      return;
    }
    this.#ended = true;
    this.emitClosed();
    for (const close of this.#closers) {
      close();
    }
    this.#closers = [];
    const waiter = this.#pending;
    if (waiter) {
      this.#pending = null;
      waiter({ value: undefined, done: true });
    }
  }

  async send(data: Bytes): Promise<void> {
    await this.sendMatter(data);
  }

  async close(): Promise<void> {
    if (this.#ended) {
      return;
    }
    this.end();
    await this.disconnect();
  }

  onClose(listener: () => void): Transport.Listener {
    this.#closers.push(listener);
    return {
      close: async () => {
        this.#closers = this.#closers.filter((item) => item !== listener);
      },
    };
  }

  async *[Symbol.asyncIterator](): AsyncIterator<Bytes> {
    while (!this.#ended) {
      const queued = this.#queue.shift();
      if (queued) {
        yield queued;
        continue;
      }
      const next = await new Promise<IteratorResult<Bytes>>((resolve) => {
        this.#pending = resolve;
      });
      if (next.done) {
        return;
      }
      yield next.value;
    }
  }
}

/**
 * Central transport. `openChannel` connects, handshakes BTP, then returns
 * a channel whose payloads are Matter messages.
 */
class RadioTransport implements Transport {
  readonly #hub: RadioHub;
  readonly #pending = new Map<string, Bytes[]>();
  readonly #waiter = new Map<string, PendingWaiter>();
  readonly #sink = new Map<string, (bytes: Bytes) => void>();
  readonly #onDrop = new Map<string, () => void>();

  constructor(hub: RadioHub) {
    this.#hub = hub;
    hub.subscribe((event) => {
      this.#onEvent(event);
    });
  }

  onData(): Transport.Listener {
    return { close: async () => undefined };
  }

  async close(): Promise<void> {
    this.#sink.clear();
    for (const waiter of this.#waiter.values()) {
      waiter.reject(new Error("radio detached"));
    }
    this.#waiter.clear();
  }

  supports(type: ChannelType): boolean {
    return type === ChannelType.BLE;
  }

  async openChannel(address: ServerAddress): Promise<RadioChannel> {
    if (!ServerAddress.isBle(address)) {
      throw new Error("radio central only opens bluetooth addresses");
    }
    const peripheral = address.peripheralAddress;
    this.#pending.delete(peripheral);
    this.#waiter.delete(peripheral);

    await this.#hub.request("connect", { address: peripheral }, CONNECT_MS);
    try {
      await this.#hub.request("subscribe", { address: peripheral });
      const handshake = BtpCodec.encodeBtpHandshakeRequest({
        versions: [...MatterBle.BTP_SUPPORTED_VERSIONS],
        attMtu: MatterBle.MAXIMUM_ATT_MTU,
        clientWindowSize: 5,
      });
      await this.#hub.request("write", {
        address: peripheral,
        value_b64: Bytes.toBase64(handshake),
      });
      const response = await this.#next(peripheral, HANDSHAKE_MS);
      const early: Bytes[] = [];
      let channel: RadioChannel | undefined;
      const session = await BtpSessionHandler.createAsCentral(
        response,
        (data) => this.#write(peripheral, data),
        () => this.#drop(peripheral),
        async (data) => {
          if (channel) {
            channel.push(data);
          } else {
            early.push(data);
          }
        },
      );
      channel = new RadioChannel(
        peripheral,
        (data) => session.sendMatterMessage(data),
        () => this.#drop(peripheral),
      );
      for (const data of early) {
        channel.push(data);
      }
      this.#onDrop.set(peripheral, () => {
        channel?.end();
      });
      const sink = (data: Bytes) => {
        void session.handleIncomingBleData(data);
      };
      this.#sink.set(peripheral, sink);
      const queued = this.#pending.get(peripheral) ?? [];
      this.#pending.delete(peripheral);
      for (const bytes of queued) {
        sink(bytes);
      }
      session.closed.on(() => {
        channel?.end();
      });
      return channel;
    } catch (err) {
      try {
        await this.#drop(peripheral);
      } catch (dropErr) {
        const primary = err instanceof Error ? err.message : String(err);
        const secondary = dropErr instanceof Error ? dropErr.message : String(dropErr);
        throw new Error(`${primary} (disconnect: ${secondary})`);
      }
      throw err;
    }
  }

  async #write(address: string, data: Bytes): Promise<void> {
    await this.#hub.request("write", {
      address,
      value_b64: Bytes.toBase64(data),
    });
  }

  async #drop(address: string): Promise<void> {
    this.#sink.delete(address);
    this.#pending.delete(address);
    await this.#hub.request("disconnect", { address });
  }

  #next(address: string, timeoutMs: number): Promise<Bytes> {
    const queued = this.#pending.get(address);
    const first = queued?.shift();
    if (first) {
      return Promise.resolve(first);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiter.delete(address);
        reject(new Error("radio_unavailable: bluetooth handshake timed out"));
      }, timeoutMs);
      this.#waiter.set(address, {
        resolve: (bytes) => {
          clearTimeout(timer);
          resolve(bytes);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
    });
  }

  /** Route a Hath event to the open handshake, the BTP sink, or the pending queue. */
  #onEvent(event: RadioEvent): void {
    if (event.kind === "disconnected") {
      const waiter = this.#waiter.get(event.address);
      this.#waiter.delete(event.address);
      waiter?.reject(new Error("bluetooth device disconnected"));
      this.#onDrop.get(event.address)?.();
      this.#onDrop.delete(event.address);
      return;
    }
    if (event.kind !== "notification" || !event.value_b64) {
      return;
    }
    const bytes = Bytes.fromBase64(event.value_b64);
    const sink = this.#sink.get(event.address);
    if (sink) {
      sink(bytes);
      return;
    }
    const waiter = this.#waiter.get(event.address);
    if (waiter) {
      this.#waiter.delete(event.address);
      waiter.resolve(bytes);
      return;
    }
    const queue = this.#pending.get(event.address) ?? [];
    queue.push(bytes);
    this.#pending.set(event.address, queue);
  }
}

/**
 * Peripheral side is unused. Ghar commissions; it does not advertise.
 */
class ClosedPeripheral implements BlePeripheralInterface {
  onData(): Transport.Listener {
    return { close: async () => undefined };
  }

  async close(): Promise<void> {}

  supports(): boolean {
    return false;
  }

  async openChannel(): Promise<never> {
    throw new Error("ghar does not accept bluetooth connections");
  }

  async advertise(): Promise<void> {
    throw new Error("ghar does not advertise over bluetooth");
  }

  async stopAdvertising(): Promise<void> {}
}

/**
 * Install on the controller environment before the server starts so
 * commissioning can select a BLE scanner.
 */
export class RadioBle extends Ble {
  readonly #scanner: BleScanner;
  readonly #central: RadioTransport;
  readonly #peripheral = new ClosedPeripheral();

  constructor(hub: RadioHub) {
    super();
    this.#scanner = new BleScanner(new RadioScanClient(hub));
    this.#central = new RadioTransport(hub);
  }

  get peripheralInterface(): BlePeripheralInterface {
    return this.#peripheral;
  }

  get centralInterface(): Transport {
    return this.#central;
  }

  get scanner(): BleScanner {
    return this.#scanner;
  }
}

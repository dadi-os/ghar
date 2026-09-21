import assert from "node:assert/strict";
import { test } from "node:test";
import {
  distinctDeviceLabel,
  endpointDisplayName,
  isStockDeviceName,
} from "../src/matter/registry.js";

test("a label that is only the product string is discarded", () => {
  assert.equal(distinctDeviceLabel("TS0501B", "TS0501B"), null);
  assert.equal(distinctDeviceLabel("  ts0501b ", "TS0501B"), null);
  assert.equal(distinctDeviceLabel("  Desk lamp ", "TS0501B"), "Desk lamp");
  assert.equal(distinctDeviceLabel("   ", "TS0501B"), null);
  assert.equal(distinctDeviceLabel(null, "TS0501B"), null);
});

test("a unique label stays bare, and a shared label gains the endpoint", () => {
  assert.equal(
    endpointDisplayName({
      endpointLabel: "Desk lamp",
      nodeLabel: "Nightstand",
      productName: "TS0501B",
      endpoint: 2,
      peersSharingLabel: 1,
    }),
    "Desk lamp",
  );
  assert.equal(
    endpointDisplayName({
      endpointLabel: null,
      nodeLabel: "Nightstand",
      productName: "TS0501B",
      endpoint: 1,
      peersSharingLabel: 2,
    }),
    "Nightstand (1)",
  );
});

test("with no label, the name is the product, or Device when that is empty", () => {
  assert.equal(
    endpointDisplayName({
      endpointLabel: null,
      nodeLabel: null,
      productName: "TS0501B",
      endpoint: 1,
      peersSharingLabel: 1,
    }),
    "TS0501B",
  );
  assert.equal(
    endpointDisplayName({
      endpointLabel: null,
      nodeLabel: null,
      productName: "  ",
      endpoint: 3,
      peersSharingLabel: 1,
    }),
    "Device",
  );
});

test("generated product names are stock; a rename is not", () => {
  assert.equal(isStockDeviceName("TS0501B (1)", "TS0501B"), true);
  assert.equal(isStockDeviceName("TS0501B", "TS0501B"), true);
  assert.equal(isStockDeviceName("Device", null), true);
  assert.equal(isStockDeviceName("device-12-1", null), true);
  assert.equal(isStockDeviceName("Left nightstand lamp", "TS0501B"), false);
  assert.equal(isStockDeviceName("Hallway", null), false);
});

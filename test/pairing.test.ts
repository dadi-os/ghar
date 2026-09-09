import assert from "node:assert/strict";
import { test } from "node:test";
import { ManualPairingCodeCodec } from "@matter/main/types";
import { decodePairingCode } from "../src/matter/pairing.js";

test("decodePairingCode accepts a library-encoded manual code", () => {
  // Encode via the library so we do not hand-parse digits.
  const encoded = ManualPairingCodeCodec.encode({
    passcode: 20202021,
    discriminator: 3840,
  });
  const decoded = decodePairingCode(encoded);
  assert.equal(decoded.passcode, 20202021);
  assert.equal(decoded.shortDiscriminator, ManualPairingCodeCodec.decode(encoded).shortDiscriminator);
});

test("decodePairingCode rejects empty input", () => {
  assert.throws(() => decodePairingCode("   "), /empty/);
});

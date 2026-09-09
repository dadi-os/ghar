/**
 * Decode Matter pairing codes (manual and QR) into passcode + discriminator.
 */

import { ManualPairingCodeCodec, QrPairingCodeCodec, VendorId } from "@matter/main/types";

export type DecodedPairing = {
  passcode: number;
  shortDiscriminator?: number;
  longDiscriminator?: number;
  vendorId?: VendorId;
  productId?: number;
};

/**
 * Decode a manual pairing code or QR payload (`MT:...`).
 * @throws When the code cannot be decoded.
 */
export function decodePairingCode(code: string): DecodedPairing {
  const trimmed = code.trim();
  if (trimmed.length === 0) {
    throw new Error("pairing code is empty");
  }

  if (trimmed.toUpperCase().startsWith("MT:")) {
    const entries = QrPairingCodeCodec.decode(trimmed);
    const first = entries[0];
    if (!first) {
      throw new Error("QR pairing code contained no entries");
    }
    const out: DecodedPairing = {
      passcode: first.passcode,
      longDiscriminator: first.discriminator,
    };
    if (first.vendorId !== undefined) {
      out.vendorId = VendorId(first.vendorId, false);
    }
    if (first.productId !== undefined) {
      out.productId = first.productId;
    }
    return out;
  }

  const decoded = ManualPairingCodeCodec.decode(trimmed);
  const out: DecodedPairing = {
    passcode: decoded.passcode,
  };
  if (decoded.shortDiscriminator !== undefined) {
    out.shortDiscriminator = decoded.shortDiscriminator;
  }
  if (decoded.vendorId !== undefined) {
    out.vendorId = decoded.vendorId;
  }
  if (decoded.productId !== undefined) {
    out.productId = decoded.productId;
  }
  return out;
}

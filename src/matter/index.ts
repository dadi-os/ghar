/** Public Matter fabric API for Ghar (HTTP layer arrives in prompt 03). */

export { brightnessFromMatter, brightnessToMatter } from "./brightness.js";
export {
  ClusterId,
  deriveCapabilities,
  type CapabilityRecord,
  type EndpointDescriptor,
  type GharCapability,
} from "./capabilities.js";
export { PendingCauseTracker, type EventCause } from "./cause.js";
export { CommissioningService, type CommissionJob, type CommissionStatus } from "./commissioning.js";
export {
  setBrightness,
  setColor,
  setOnOff,
  type ColorCommand,
  type CommandIssuer,
} from "./commands.js";
export { FabricController, type FabricControllerOptions } from "./controller.js";
export type { MatterController } from "./controller-api.js";
export { isSignificantChange, DEADBAND } from "./deadband.js";
export { applyObservation } from "./events.js";
export { decodePairingCode, type DecodedPairing } from "./pairing.js";
export { StateCache } from "./state-cache.js";

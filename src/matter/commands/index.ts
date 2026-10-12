/**
 * Device commands: the table of every command Ghar sends, by capability, with its params
 * schema and how it runs against a live endpoint, plus identify and label writes.
 * Each command notes the state keys it changes so the resulting reports carry its cause.
 */

import type { ClientNode, Endpoint } from "@matter/main";
import { BasicInformationClient } from "@matter/main/behaviors/basic-information";
import { BridgedDeviceBasicInformationClient } from "@matter/main/behaviors/bridged-device-basic-information";
import { IdentifyClient } from "@matter/main/behaviors/identify";
import { DEVICE_OPERATION_TIMEOUT_MS } from "../../constants.js";
import { GharError } from "../../errors.js";
import type { DeviceKind, GharCapability } from "../capabilities.js";
import type { PendingCauseTracker } from "../cause.js";
import { withTimeout } from "../timeout.js";
import { applianceCommands } from "./appliances.js";
import { climateCommands } from "./climate.js";
import { coverCommands } from "./covers.js";
import { lightingCommands } from "./lighting.js";
import { mediaCommands } from "./media.js";
import type { CommandContext, CommandSpec } from "./spec.js";

/** How long Identify tells the device to blink, in seconds. */
const IDENTIFY_SECONDS = 5;

export type CommandIssuer = {
  cause: "agent" | "user";
  causeRef?: string;
};

/** Every command Ghar sends, by capability and command name. */
export const COMMANDS: Partial<Record<GharCapability, Readonly<Record<string, CommandSpec>>>> = {
  ...lightingCommands,
  ...coverCommands,
  ...climateCommands,
  ...applianceCommands,
  ...mediaCommands,
};

/**
 * The spec for `capability`.`command`, or `invalid_request` naming the commands the
 * capability does have.
 */
export function commandSpec(capability: GharCapability, name: string): CommandSpec {
  const commands = COMMANDS[capability];
  if (!commands) {
    throw new GharError(422, "invalid_request", `${capability} has no commands`);
  }
  const spec = commands[name];
  if (!spec) {
    throw new GharError(
      422,
      "invalid_request",
      `${capability} has no command ${name}; it has ${Object.keys(commands).join(", ")}`,
    );
  }
  return spec;
}

/** A validated command for one device, with the config of the capability it targets. */
export type DeviceCommand = {
  capability: GharCapability;
  command: string;
  params: unknown;
  config: Record<string, unknown>;
};

function findEndpoint(node: ClientNode, endpointNumber: number): Endpoint {
  const endpoint = node.parts.get(endpointNumber);
  if (!endpoint) {
    throw new Error(`endpoint ${endpointNumber} not found on node`);
  }
  return endpoint;
}

/** Run a validated command against a device's endpoint, within the device operation timeout. */
export async function runCommand(
  target: {
    node: ClientNode;
    endpoint: number;
    deviceId: string;
    kind: DeviceKind;
  },
  cmd: DeviceCommand,
  causes: PendingCauseTracker,
  issuer: CommandIssuer,
): Promise<void> {
  const spec = commandSpec(cmd.capability, cmd.command);
  const ctx: CommandContext = {
    endpoint: findEndpoint(target.node, target.endpoint),
    kind: target.kind,
    config: cmd.config,
    note: (...keys) => {
      for (const key of keys) {
        causes.note(target.deviceId, key, issuer.cause, issuer.causeRef);
      }
    },
  };
  await withTimeout(
    spec.run(ctx, cmd.params),
    DEVICE_OPERATION_TIMEOUT_MS,
    `${cmd.capability}.${cmd.command}(${target.deviceId})`,
  );
}

/**
 * Blink the endpoint via Identify.
 * Throws `capability_unsupported` when the cluster is absent.
 */
export async function identifyDevice(node: ClientNode, endpointNumber: number): Promise<void> {
  const endpoint = findEndpoint(node, endpointNumber);
  if (!endpoint.behaviors.has(IdentifyClient)) {
    throw new GharError(422, "capability_unsupported", "device does not support identify");
  }
  const commands = endpoint.commandsOf(IdentifyClient);
  await withTimeout(
    Promise.resolve(commands.identify({ identifyTime: IDENTIFY_SECONDS })),
    DEVICE_OPERATION_TIMEOUT_MS,
    `identify(${endpointNumber})`,
  );
}

/**
 * Write the device's Matter node label.
 * Bridged endpoints keep their own label; everyone else uses the node.
 */
export async function writeDeviceLabel(
  node: ClientNode,
  endpointNumber: number,
  name: string,
): Promise<void> {
  const endpoint = findEndpoint(node, endpointNumber);
  if (endpoint.behaviors.has(BridgedDeviceBasicInformationClient)) {
    await withTimeout(
      endpoint.setStateOf(BridgedDeviceBasicInformationClient, { nodeLabel: name }),
      DEVICE_OPERATION_TIMEOUT_MS,
      `writeLabel(${endpointNumber})`,
    );
    return;
  }
  await withTimeout(
    node.setStateOf(BasicInformationClient, { nodeLabel: name }),
    DEVICE_OPERATION_TIMEOUT_MS,
    "writeNodeLabel",
  );
}

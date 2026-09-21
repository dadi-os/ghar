/** Device command helpers with timeouts and cause-pending notes. */

import type { ClientNode, Endpoint } from "@matter/main";
import { BasicInformationClient } from "@matter/main/behaviors/basic-information";
import { BridgedDeviceBasicInformationClient } from "@matter/main/behaviors/bridged-device-basic-information";
import { ColorControlClient } from "@matter/main/behaviors/color-control";
import { IdentifyClient } from "@matter/main/behaviors/identify";
import { LevelControlClient } from "@matter/main/behaviors/level-control";
import { OnOffClient } from "@matter/main/behaviors/on-off";
import { DEVICE_OPERATION_TIMEOUT_MS } from "../constants.js";
import { GharError } from "../errors.js";
import { brightnessToMatter } from "./brightness.js";
import type { PendingCauseTracker } from "./cause.js";
import { withTimeout } from "./timeout.js";

/** How long Identify tells the device to blink, in seconds. */
const IDENTIFY_SECONDS = 5;

export type CommandIssuer = {
  cause: "agent" | "user";
  causeRef?: string;
};

function findEndpoint(node: ClientNode, endpointNumber: number): Endpoint {
  const endpoint = node.parts.get(endpointNumber);
  if (!endpoint) {
    throw new Error(`endpoint ${endpointNumber} not found on node`);
  }
  return endpoint;
}

function noteCause(
  causes: PendingCauseTracker,
  deviceId: string,
  attributeKey: string,
  issuer: CommandIssuer,
): void {
  causes.note(deviceId, attributeKey, issuer.cause, issuer.causeRef);
}

/** Turn a switchable endpoint on or off. */
export async function setOnOff(
  node: ClientNode,
  endpointNumber: number,
  deviceId: string,
  on: boolean,
  causes: PendingCauseTracker,
  issuer: CommandIssuer,
): Promise<void> {
  const endpoint = findEndpoint(node, endpointNumber);
  const commands = endpoint.commandsOf(OnOffClient);
  noteCause(causes, deviceId, "on", issuer);
  await withTimeout(
    on ? Promise.resolve(commands.on()) : Promise.resolve(commands.off()),
    DEVICE_OPERATION_TIMEOUT_MS,
    `setOnOff(${deviceId})`,
  );
}

/** Set brightness 0–100 via Level Control moveToLevelWithOnOff. */
export async function setBrightness(
  node: ClientNode,
  endpointNumber: number,
  deviceId: string,
  percent: number,
  causes: PendingCauseTracker,
  issuer: CommandIssuer,
): Promise<void> {
  const endpoint = findEndpoint(node, endpointNumber);
  const commands = endpoint.commandsOf(LevelControlClient);
  const level = brightnessToMatter(percent);
  noteCause(causes, deviceId, "brightness", issuer);
  noteCause(causes, deviceId, "on", issuer);
  await withTimeout(
    Promise.resolve(
      commands.moveToLevelWithOnOff({
        level,
        transitionTime: null,
        optionsMask: {},
        optionsOverride: {},
      }),
    ),
    DEVICE_OPERATION_TIMEOUT_MS,
    `setBrightness(${deviceId})`,
  );
}

export type ColorCommand =
  | { colorTempMireds: number }
  | { hue: number; saturation: number };

/** Set color via Color Control — color temperature or hue/saturation. */
export async function setColor(
  node: ClientNode,
  endpointNumber: number,
  deviceId: string,
  color: ColorCommand,
  causes: PendingCauseTracker,
  issuer: CommandIssuer,
): Promise<void> {
  const endpoint = findEndpoint(node, endpointNumber);
  const commands = endpoint.commandsOf(ColorControlClient);

  if ("colorTempMireds" in color) {
    noteCause(causes, deviceId, "color_temp", issuer);
    await withTimeout(
      Promise.resolve(
        commands.moveToColorTemperature({
          colorTemperatureMireds: color.colorTempMireds,
          transitionTime: 0,
          optionsMask: {},
          optionsOverride: {},
        }),
      ),
      DEVICE_OPERATION_TIMEOUT_MS,
      `setColorTemp(${deviceId})`,
    );
    return;
  }

  noteCause(causes, deviceId, "hue", issuer);
  noteCause(causes, deviceId, "saturation", issuer);
  await withTimeout(
    Promise.resolve(
      commands.moveToHueAndSaturation({
        hue: color.hue,
        saturation: color.saturation,
        transitionTime: 0,
        optionsMask: {},
        optionsOverride: {},
      }),
    ),
    DEVICE_OPERATION_TIMEOUT_MS,
    `setHueSat(${deviceId})`,
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

/** The tools a control run's model calls: read devices, command a device. */

import { z } from "zod";
import type { Db } from "../db/client.js";
import { issueDeviceCommand } from "../routers/devices.js";
import { getDevice, listDevices } from "../routers/devices-query.js";
import { CAPABILITIES, DEVICE_KINDS } from "../matter/capabilities.js";
import type { MatterController } from "../matter/controller-api.js";
import type { ControlTools } from "./loop.js";

const getDevicesInput = z
  .object({
    device_ids: z.array(z.string().uuid()).min(1).optional(),
    room: z.string().min(1).optional(),
    tag: z.string().min(1).optional(),
    capability: z.enum(CAPABILITIES).optional(),
    kind: z.enum(DEVICE_KINDS).optional(),
  })
  .strict();

const commandDeviceInput = z
  .object({
    device_id: z.string().uuid(),
    capability: z.enum(CAPABILITIES),
    command: z.string().min(1),
    params: z.record(z.unknown()).optional(),
  })
  .strict();

/**
 * controlTools returns the tools one control run holds. Commands are attributed to
 * `caller`, the agent that made the request.
 */
export function controlTools(deps: { db: Db; controller: MatterController }, caller: string): ControlTools {
  return {
    specs: [
      {
        name: "get_devices",
        description:
          "Read devices: each one's id, name, room, tags, kind, online flag, capabilities with their config, and current state (each value with when it last changed). Give device_ids for specific devices, or room, tag, capability or kind to filter, or nothing for every device.",
        input_schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            device_ids: { type: "array", items: { type: "string" }, minItems: 1, description: "Only these devices" },
            room: { type: "string", description: "Only devices in this room" },
            tag: { type: "string", description: "Only devices with this tag" },
            capability: { type: "string", enum: [...CAPABILITIES], description: "Only devices that expose this capability" },
            kind: { type: "string", enum: [...DEVICE_KINDS], description: "Only devices of this kind" },
          },
        },
      },
      {
        name: "command_device",
        description:
          "Send one command to a device and wait for it. capability is one the device lists in get_devices; command and params are that capability's (on_off on|off|toggle; level move_to {level 0–100}; color temperature {mireds} | hue_saturation {hue, saturation 0–254}; cover open|close|stop|go_to_lift {percent_open}|go_to_tilt {percent}; fan set_mode {mode}|set_percent {percent}; thermostat set_mode {mode}|set_setpoint {heat_c, cool_c}; valve open {duration_s?, level?}|close; pump set_mode {mode}; alarm self_test; rvc pause|go_home|set_clean_mode {mode}|select_areas {areas}; appliance pause|stop; mode change_to {mode}; media play|pause|stop|next|previous|select_input {index}|send_key {key}|launch_app {application_id, catalog_vendor_id}; camera set_privacy {enabled}). lock, sensor, button, power_source and energy are read-only: read them with get_devices. command_rejected means the device refused; device_unreachable means it did not answer.",
        input_schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            device_id: { type: "string" },
            capability: { type: "string", enum: [...CAPABILITIES] },
            command: { type: "string" },
            params: { type: "object", description: "The command's params; omit when it takes none" },
          },
          required: ["device_id", "capability", "command"],
        },
      },
    ],
    async call(name, input) {
      if (name === "get_devices") {
        const parsed = getDevicesInput.parse(input ?? {});
        if (parsed.device_ids !== undefined) {
          const found = await Promise.all(parsed.device_ids.map((id) => getDevice(deps.db, deps.controller, id)));
          return JSON.stringify({ devices: found });
        }
        const { device_ids: _ids, ...filters } = parsed;
        return JSON.stringify({ devices: await listDevices(deps.db, deps.controller, filters) });
      }
      if (name === "command_device") {
        const parsed = commandDeviceInput.parse(input);
        await issueDeviceCommand(deps, parsed.device_id, parsed, { cause: "agent", causeRef: caller });
        return JSON.stringify({ ok: true });
      }
      throw new Error(`unknown control tool ${name}`);
    },
  };
}

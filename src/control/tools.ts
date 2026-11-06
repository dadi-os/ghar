/** The tools a control run's model calls: read devices, command a device, and manage tags. */

import { z } from "zod";
import type { Db } from "../db/client.js";
import { renameTagByName, tagDevices, untagDevices } from "../db/tags.js";
import { issueDeviceCommand } from "../routers/devices.js";
import { getDevice, listDevices } from "../routers/devices-query.js";
import { CAPABILITIES, DEVICE_KINDS } from "../matter/capabilities.js";
import type { MatterController } from "../matter/controller-api.js";
import type { ControlTools } from "./loop.js";

const getDevicesInput = z
  .object({
    device_ids: z.array(z.string().uuid()).min(1).optional(),
    tag: z.string().min(1).optional(),
    capability: z.enum(CAPABILITIES).optional(),
    kind: z.enum(DEVICE_KINDS).optional(),
  })
  .strict();

const tagDevicesInput = z
  .object({
    tag: z.string().min(1),
    device_ids: z.array(z.string().uuid()).min(1),
  })
  .strict();

const renameTagInput = z
  .object({
    tag: z.string().min(1),
    new_name: z.string().min(1),
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
          "Read devices: each one's id, name, tags, kind, online flag, capabilities with their config, and current state (each value with when it last changed). Give device_ids for specific devices, or tag, capability or kind to filter, or nothing for every device.",
        input_schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            device_ids: { type: "array", items: { type: "string" }, minItems: 1, description: "Only these devices" },
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
      {
        name: "tag_devices",
        description:
          "Put devices under a tag, making the tag if it does not exist. A tag is a free-text name like \"ankur's bed lights\"; a device can carry any number of tags and keeps the ones it has. Use the exact tag name get_devices shows when one exists.",
        input_schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            tag: { type: "string", description: "The tag's name" },
            device_ids: { type: "array", items: { type: "string" }, minItems: 1, description: "The devices to add, by id from get_devices" },
          },
          required: ["tag", "device_ids"],
        },
      },
      {
        name: "untag_devices",
        description:
          "Take devices out of a tag. The devices stay and keep their other tags; a tag with no devices left disappears.",
        input_schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            tag: { type: "string", description: "The tag's name" },
            device_ids: { type: "array", items: { type: "string" }, minItems: 1, description: "The devices to take out, by id" },
          },
          required: ["tag", "device_ids"],
        },
      },
      {
        name: "rename_tag",
        description: "Rename a tag for every device that carries it. A name another tag already has is refused.",
        input_schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            tag: { type: "string", description: "The tag's current name" },
            new_name: { type: "string" },
          },
          required: ["tag", "new_name"],
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
      if (name === "tag_devices") {
        const parsed = tagDevicesInput.parse(input);
        await tagDevices(deps.db, parsed.tag, parsed.device_ids);
        return JSON.stringify({ ok: true });
      }
      if (name === "untag_devices") {
        const parsed = tagDevicesInput.parse(input);
        await untagDevices(deps.db, parsed.tag, parsed.device_ids);
        return JSON.stringify({ ok: true });
      }
      if (name === "rename_tag") {
        const parsed = renameTagInput.parse(input);
        await renameTagByName(deps.db, parsed.tag, parsed.new_name);
        return JSON.stringify({ ok: true });
      }
      throw new Error(`unknown control tool ${name}`);
    },
  };
}

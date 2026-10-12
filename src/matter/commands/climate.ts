/** Thermostat and temperature control commands. Temperatures are °C; Matter takes hundredths. */

import { TemperatureControlClient } from "@matter/main/behaviors/temperature-control";
import { ThermostatClient } from "@matter/main/behaviors/thermostat";
import { z } from "zod";
import { GharError } from "../../errors.js";
import { command } from "./spec.js";

/** Thermostat SystemMode values Ghar accepts by name. */
const SYSTEM_MODES = { off: 0, auto: 1, cool: 3, heat: 4, emergency_heat: 5, precooling: 6, fan_only: 7, dry: 8, sleep: 9 } as const;

const celsius = z.number().min(-50).max(300);

export const climateCommands = {
  thermostat: {
    set_mode: command(
      z.object({ mode: z.enum(["off", "auto", "cool", "heat", "emergency_heat", "precooling", "fan_only", "dry", "sleep"]) }).strict(),
      async ({ endpoint, note }, { mode }) => {
        note("system_mode", "running");
        await endpoint.setStateOf(ThermostatClient, { systemMode: SYSTEM_MODES[mode] });
      },
    ),
    set_setpoint: command(
      z
        .object({ heat_c: celsius.optional(), cool_c: celsius.optional() })
        .strict()
        .refine((value) => value.heat_c !== undefined || value.cool_c !== undefined, {
          message: "give heat_c, cool_c or both",
        }),
      async ({ endpoint, config, note }, { heat_c, cool_c }) => {
        if (heat_c !== undefined && config.heat !== true) {
          throw new GharError(422, "capability_unsupported", "this thermostat does not heat");
        }
        if (cool_c !== undefined && config.cool !== true) {
          throw new GharError(422, "capability_unsupported", "this thermostat does not cool");
        }
        note("heat_setpoint", "cool_setpoint", "running");
        await endpoint.setStateOf(ThermostatClient, {
          ...(heat_c !== undefined ? { occupiedHeatingSetpoint: Math.round(heat_c * 100) } : {}),
          ...(cool_c !== undefined ? { occupiedCoolingSetpoint: Math.round(cool_c * 100) } : {}),
        });
      },
    ),
  },
  temperature_control: {
    set: command(
      z.union([
        z.object({ celsius }).strict(),
        z.object({ level: z.number().int().min(0) }).strict(),
      ]),
      async ({ endpoint, config, note }, params) => {
        if ("celsius" in params && config.numeric !== true) {
          throw new GharError(422, "capability_unsupported", "this device takes a temperature level, not degrees");
        }
        if ("level" in params && config.numeric === true) {
          throw new GharError(422, "capability_unsupported", "this device takes degrees, not a level");
        }
        note("target_temperature", "temperature_level");
        await endpoint
          .commandsOf(TemperatureControlClient)
          .setTemperature(
            "celsius" in params
              ? { targetTemperature: Math.round(params.celsius * 100) }
              : { targetTemperatureLevel: params.level },
          );
      },
    ),
  },
};

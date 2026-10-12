/** Window covering, fan, valve and pump commands: the things that move air, light or water. */

import { FanControlClient } from "@matter/main/behaviors/fan-control";
import { PumpConfigurationAndControlClient } from "@matter/main/behaviors/pump-configuration-and-control";
import { ValveConfigurationAndControlClient } from "@matter/main/behaviors/valve-configuration-and-control";
import { WindowCoveringClient } from "@matter/main/behaviors/window-covering";
import { GharError } from "../../errors.js";
import { z } from "zod";
import { command } from "./spec.js";

const none = z.object({}).strict();
const percent = z.number().int().min(0).max(100);

/** Fan Control FanMode values Ghar accepts by name. */
const FAN_MODES = { off: 0, low: 1, medium: 2, high: 3, on: 4, auto: 5 } as const;

/** Pump OperationMode values Ghar accepts by name. */
const PUMP_MODES = { normal: 0, minimum: 1, maximum: 2, local: 3 } as const;

export const coverCommands = {
  cover: {
    open: command(none, async ({ endpoint, note }) => {
      note("open_percent", "moving");
      await endpoint.commandsOf(WindowCoveringClient).upOrOpen();
    }),
    close: command(none, async ({ endpoint, note }) => {
      note("open_percent", "moving");
      await endpoint.commandsOf(WindowCoveringClient).downOrClose();
    }),
    stop: command(none, async ({ endpoint, note }) => {
      note("moving");
      await endpoint.commandsOf(WindowCoveringClient).stopMotion();
    }),
    go_to_lift: command(z.object({ percent_open: percent }).strict(), async ({ endpoint, note }, params) => {
      note("open_percent", "moving");
      await endpoint
        .commandsOf(WindowCoveringClient)
        .goToLiftPercentage({ liftPercent100thsValue: (100 - params.percent_open) * 100 });
    }),
    go_to_tilt: command(z.object({ percent: percent }).strict(), async ({ endpoint, note }, params) => {
      note("tilt_percent", "moving");
      await endpoint
        .commandsOf(WindowCoveringClient)
        .goToTiltPercentage({ tiltPercent100thsValue: params.percent * 100 });
    }),
  },
  fan: {
    set_mode: command(
      z.object({ mode: z.enum(["off", "low", "medium", "high", "on", "auto"]) }).strict(),
      async ({ endpoint, note }, { mode }) => {
        note("fan_mode", "fan_percent");
        await endpoint.setStateOf(FanControlClient, { fanMode: FAN_MODES[mode] });
      },
    ),
    set_percent: command(z.object({ percent }).strict(), async ({ endpoint, note }, params) => {
      note("fan_mode", "fan_percent");
      await endpoint.setStateOf(FanControlClient, { percentSetting: params.percent });
    }),
  },
  valve: {
    open: command(
      z
        .object({
          duration_s: z.number().int().min(1).max(86_400).optional(),
          level: z.number().int().min(1).max(100).optional(),
        })
        .strict(),
      async ({ endpoint, config, note }, params) => {
        if (params.level !== undefined && config.level !== true) {
          throw new GharError(422, "capability_unsupported", "this valve only opens fully");
        }
        note("valve", "open_remaining_s", "valve_level");
        await endpoint.commandsOf(ValveConfigurationAndControlClient).open({
          ...(params.duration_s !== undefined ? { openDuration: params.duration_s } : {}),
          ...(params.level !== undefined ? { targetLevel: params.level } : {}),
        });
      },
    ),
    close: command(none, async ({ endpoint, note }) => {
      note("valve", "open_remaining_s", "valve_level");
      await endpoint.commandsOf(ValveConfigurationAndControlClient).close();
    }),
  },
  pump: {
    set_mode: command(
      z.object({ mode: z.enum(["normal", "minimum", "maximum", "local"]) }).strict(),
      async ({ endpoint, note }, { mode }) => {
        note("pump_mode");
        await endpoint.setStateOf(PumpConfigurationAndControlClient, { operationMode: PUMP_MODES[mode] });
      },
    ),
  },
};

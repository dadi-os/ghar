/** Window covering and fan commands. */

import { FanControlClient } from "@matter/main/behaviors/fan-control";
import { WindowCoveringClient } from "@matter/main/behaviors/window-covering";
import { z } from "zod";
import { command } from "./spec.js";

const none = z.object({}).strict();
const percent = z.number().int().min(0).max(100);

/** Fan Control FanMode values Ghar accepts by name. */
const FAN_MODES = { off: 0, low: 1, medium: 2, high: 3, on: 4, auto: 5 } as const;

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
};

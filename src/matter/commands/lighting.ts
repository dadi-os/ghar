/** On/off, level (brightness or volume) and color commands. */

import { ColorControlClient } from "@matter/main/behaviors/color-control";
import { LevelControlClient } from "@matter/main/behaviors/level-control";
import { OnOffClient } from "@matter/main/behaviors/on-off";
import { z } from "zod";
import { brightnessToMatter } from "../brightness.js";
import { command } from "./spec.js";

const none = z.object({}).strict();

/** Options that apply a color or level change even while the light is off. */
const NO_OPTIONS = { optionsMask: {}, optionsOverride: {} };

/** The state key a level change moves: volume on media devices, brightness on everything else. */
function levelKey(kind: string): string {
  return kind === "speaker" || kind === "tv" ? "volume" : "brightness";
}

export const lightingCommands = {
  on_off: {
    on: command(none, async ({ endpoint, note }) => {
      note("on");
      await endpoint.commandsOf(OnOffClient).on();
    }),
    off: command(none, async ({ endpoint, note }) => {
      note("on");
      await endpoint.commandsOf(OnOffClient).off();
    }),
    toggle: command(none, async ({ endpoint, note }) => {
      note("on");
      await endpoint.commandsOf(OnOffClient).toggle();
    }),
  },
  level: {
    move_to: command(
      z.object({ level: z.number().min(0).max(100) }).strict(),
      async ({ endpoint, kind, note }, { level }) => {
        const commands = endpoint.commandsOf(LevelControlClient);
        const request = { level: brightnessToMatter(level), transitionTime: null, ...NO_OPTIONS };
        note(levelKey(kind));
        if (kind === "light" || kind === "plug") {
          note("on");
          await commands.moveToLevelWithOnOff(request);
          return;
        }
        await commands.moveToLevel(request);
      },
    ),
  },
  color: {
    temperature: command(
      z.object({ mireds: z.number().int().min(1).max(65279) }).strict(),
      async ({ endpoint, note }, { mireds }) => {
        note("color_temp", "color_mode");
        await endpoint
          .commandsOf(ColorControlClient)
          .moveToColorTemperature({ colorTemperatureMireds: mireds, transitionTime: 0, ...NO_OPTIONS });
      },
    ),
    hue_saturation: command(
      z.object({ hue: z.number().int().min(0).max(254), saturation: z.number().int().min(0).max(254) }).strict(),
      async ({ endpoint, note }, { hue, saturation }) => {
        note("hue", "saturation", "color_mode");
        await endpoint
          .commandsOf(ColorControlClient)
          .moveToHueAndSaturation({ hue, saturation, transitionTime: 0, ...NO_OPTIONS });
      },
    ),
  },
};

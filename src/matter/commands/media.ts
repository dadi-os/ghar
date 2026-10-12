/** Media (playback, inputs, keys, apps) and camera privacy commands. */

import { ApplicationLauncherClient } from "@matter/main/behaviors/application-launcher";
import { CameraAvStreamManagementClient } from "@matter/main/behaviors/camera-av-stream-management";
import { KeypadInputClient } from "@matter/main/behaviors/keypad-input";
import { MediaInputClient } from "@matter/main/behaviors/media-input";
import { MediaPlaybackClient } from "@matter/main/behaviors/media-playback";
import { z } from "zod";
import { command, rejectUnless } from "./spec.js";

const none = z.object({}).strict();

/** Keypad Input CEC key codes Ghar sends by name. */
const KEYS = {
  select: 0,
  up: 1,
  down: 2,
  left: 3,
  right: 4,
  root_menu: 9,
  setup_menu: 10,
  contents_menu: 11,
  exit: 13,
  back: 13,
  channel_up: 48,
  channel_down: 49,
  volume_up: 65,
  volume_down: 66,
  mute: 67,
  play: 68,
  stop: 69,
  pause: 70,
  rewind: 72,
  fast_forward: 73,
} as const;

const KEY_NAMES = Object.keys(KEYS) as [keyof typeof KEYS, ...Array<keyof typeof KEYS>];

/** A playback command that answers with a status. */
function playback(name: "play" | "pause" | "stop" | "next" | "previous") {
  return command(none, async ({ endpoint, note }) => {
    note("playback");
    const response = await endpoint.commandsOf(MediaPlaybackClient)[name]();
    rejectUnless(response.status === 0, name, response.data);
  });
}

export const mediaCommands = {
  media: {
    play: playback("play"),
    pause: playback("pause"),
    stop: playback("stop"),
    next: playback("next"),
    previous: playback("previous"),
    select_input: command(z.object({ index: z.number().int().min(0) }).strict(), async ({ endpoint, note }, { index }) => {
      note("input");
      await endpoint.commandsOf(MediaInputClient).selectInput({ index });
    }),
    send_key: command(z.object({ key: z.enum(KEY_NAMES) }).strict(), async ({ endpoint }, { key }) => {
      const response = await endpoint.commandsOf(KeypadInputClient).sendKey({ keyCode: KEYS[key] });
      rejectUnless(response.status === 0, "send_key");
    }),
    launch_app: command(
      z.object({ application_id: z.string().min(1), catalog_vendor_id: z.number().int().min(0) }).strict(),
      async ({ endpoint, note }, params) => {
        note("app");
        const response = await endpoint.commandsOf(ApplicationLauncherClient).launchApp({
          application: { applicationId: params.application_id, catalogVendorId: params.catalog_vendor_id },
        });
        rejectUnless(response.status === 0, "launch_app");
      },
    ),
  },
  camera: {
    set_privacy: command(z.object({ enabled: z.boolean() }).strict(), async ({ endpoint, note }, { enabled }) => {
      note("privacy");
      await endpoint.setStateOf(CameraAvStreamManagementClient, {
        softLivestreamPrivacyModeEnabled: enabled,
        softRecordingPrivacyModeEnabled: enabled,
      });
    }),
  },
};

/**
 * Smoke alarm, robot vacuum, appliance cycle and mode commands. Mode and area ids are the ones
 * the device lists in its capability config.
 */

import type { Endpoint } from "@matter/main";
import { RvcCleanModeClient } from "@matter/main/behaviors/rvc-clean-mode";
import { RvcOperationalStateClient } from "@matter/main/behaviors/rvc-operational-state";
import { ServiceAreaClient } from "@matter/main/behaviors/service-area";
import { SmokeCoAlarmClient } from "@matter/main/behaviors/smoke-co-alarm";
import { z } from "zod";
import { GharError } from "../../errors.js";
import { Behavior, isRecord, MODE_BEHAVIORS, type Choice } from "../capabilities.js";
import { command, rejectUnless } from "./spec.js";

const none = z.object({}).strict();

/** True when an Operational State style response reports no error. */
function operationalOk(response: unknown): boolean {
  return isRecord(response) && isRecord(response.commandResponseState) && response.commandResponseState.errorStateId === 0;
}

/** The error label an Operational State style response carries. */
function operationalError(response: unknown): string | undefined {
  if (!isRecord(response) || !isRecord(response.commandResponseState)) {
    return undefined;
  }
  const label = response.commandResponseState.errorStateLabel;
  return typeof label === "string" ? label : undefined;
}

/** Require `id` to be one of the choices the device listed. */
function requireChoice(choices: unknown, id: number, what: string): void {
  const list = Array.isArray(choices) ? (choices as Choice[]) : [];
  if (!list.some((choice) => choice.id === id)) {
    throw new GharError(
      422,
      "invalid_request",
      `${what} ${id} is not offered; choose one of ${list.map((choice) => `${choice.id} (${choice.label})`).join(", ")}`,
    );
  }
}

/** The appliance cycle behavior on an endpoint: Operational State, or an oven cavity's. */
function cycleBehavior(endpoint: Endpoint): string {
  if (endpoint.maybeStateOf(Behavior.OperationalState) !== undefined) {
    return Behavior.OperationalState;
  }
  return Behavior.OvenCavityOperationalState;
}

/** Send an appliance cycle command (stop, pause) and require the device to accept it. */
async function cycle(endpoint: Endpoint, name: "stop" | "pause"): Promise<void> {
  const behavior = cycleBehavior(endpoint);
  const send = endpoint.commandsOf(behavior)[name];
  if (!send) {
    throw new GharError(422, "capability_unsupported", `this appliance does not support ${name}`);
  }
  const response = await send(undefined);
  rejectUnless(operationalOk(response), name, operationalError(response));
}

export const applianceCommands = {
  alarm: {
    self_test: command(none, async ({ endpoint, note }) => {
      note("testing");
      await endpoint.commandsOf(SmokeCoAlarmClient).selfTestRequest();
    }),
  },
  rvc: {
    pause: command(none, async ({ endpoint, note }) => {
      note("operational_state");
      const response = await endpoint.commandsOf(RvcOperationalStateClient).pause();
      rejectUnless(operationalOk(response), "pause", operationalError(response));
    }),
    go_home: command(none, async ({ endpoint, note }) => {
      note("operational_state", "run_mode");
      const response = await endpoint.commandsOf(RvcOperationalStateClient).goHome();
      rejectUnless(operationalOk(response), "go_home", operationalError(response));
    }),
    set_clean_mode: command(
      z.object({ mode: z.number().int().min(0) }).strict(),
      async ({ endpoint, config, note }, { mode }) => {
        requireChoice(config.clean_modes, mode, "clean mode");
        note("clean_mode");
        const response = await endpoint.commandsOf(RvcCleanModeClient).changeToMode({ newMode: mode });
        rejectUnless(response.status === 0, "set_clean_mode", response.statusText);
      },
    ),
    select_areas: command(
      z.object({ areas: z.array(z.number().int().min(0)) }).strict(),
      async ({ endpoint, config, note }, { areas }) => {
        for (const area of areas) {
          requireChoice(config.areas, area, "area");
        }
        note("area");
        const response = await endpoint.commandsOf(ServiceAreaClient).selectAreas({ newAreas: areas });
        rejectUnless(response.status === 0, "select_areas", response.statusText);
      },
    ),
  },
  appliance: {
    pause: command(none, async ({ endpoint, note }) => {
      note("operational_state");
      await cycle(endpoint, "pause");
    }),
    stop: command(none, async ({ endpoint, note }) => {
      note("operational_state", "phase", "countdown_s");
      await cycle(endpoint, "stop");
    }),
  },
  mode: {
    change_to: command(
      z.object({ mode: z.number().int().min(0) }).strict(),
      async ({ endpoint, config, note }, { mode }) => {
        requireChoice(config.modes, mode, "mode");
        const behavior = MODE_BEHAVIORS.find((id) => endpoint.maybeStateOf(id) !== undefined);
        const send = behavior ? endpoint.commandsOf(behavior).changeToMode : undefined;
        if (!send) {
          throw new GharError(422, "capability_unsupported", "this device has no mode to change");
        }
        note("mode");
        const response = await send({ newMode: mode });
        if (isRecord(response) && typeof response.status === "number") {
          rejectUnless(
            response.status === 0,
            "change_to",
            typeof response.statusText === "string" ? response.statusText : undefined,
          );
        }
      },
    ),
  },
};

/** The shape of a Ghar device command and the helpers each domain's command table uses. */

import type { Endpoint } from "@matter/main";
import type { z } from "zod";
import { GharError } from "../../errors.js";
import type { DeviceKind } from "../capabilities.js";

/** What a command runs against. */
export type CommandContext = {
  endpoint: Endpoint;
  kind: DeviceKind;
  /** The capability config Ghar derived for this endpoint, such as its modes. */
  config: Record<string, unknown>;
  /** Attribute the coming reports for these state keys to this command's issuer. */
  note: (...keys: string[]) => void;
};

/** One command: its params schema and how it runs. `run` takes params the schema accepted. */
export type CommandSpec = {
  params: z.ZodTypeAny;
  run: (ctx: CommandContext, params: unknown) => Promise<void>;
};

/** Pair a params schema with the command that uses its parsed value. */
export function command<S extends z.ZodTypeAny>(
  params: S,
  run: (ctx: CommandContext, params: z.infer<S>) => Promise<void>,
): CommandSpec {
  return { params, run: (ctx, raw) => run(ctx, params.parse(raw)) };
}

/** A device's answer to a command that carries a status; anything but success is a rejection. */
export function rejectUnless(ok: boolean, what: string, detail?: string): void {
  if (!ok) {
    throw new GharError(409, "command_rejected", detail ? `${what} rejected: ${detail}` : `${what} rejected`);
  }
}

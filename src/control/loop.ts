/** The control loop: a request in plain words, a small model turning it into device commands. */

import { CONTROL_MAX_TURNS, CONTROL_TEXT_TURNS_MAX } from "../constants.js";
import { GharError } from "../errors.js";
import type { Block, Completer, Message, ToolSpec } from "./dwar.js";

/** The tools a control run may call besides `finish`, and how each one runs. */
export type ControlTools = {
  specs: ToolSpec[];
  /** Runs the named tool and returns what the model reads; a GharError becomes an error result. */
  call(name: string, input: unknown): Promise<string>;
};

/** FINISH_TOOL ends a run with the answer for the caller. */
const FINISH_TOOL = "finish";

const FINISH_SPEC: ToolSpec = {
  name: FINISH_TOOL,
  description:
    "End the request. result is what you tell the caller: what changed and the state now, or what you could not do and why. Call it once, last.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: { result: { type: "string", description: "The answer for the caller, in plain words" } },
    required: ["result"],
  },
};

const NO_TOOL_NUDGE = "Call a tool. Finish with the finish tool when the request is done or cannot be done.";

export type ControlRunArgs = {
  completer: Completer;
  tools: ControlTools;
  /** The model's system prompt. */
  charter: string;
  /** The request, as the calling agent wrote it. */
  request: string;
  /** The calling agent's id, for Dwar's inference log. */
  caller: string;
};

/**
 * runControl drives the model until it calls `finish` and returns the finish result. A model
 * that stops calling tools, or runs past CONTROL_MAX_TURNS, fails the run.
 */
export async function runControl(args: ControlRunArgs): Promise<string> {
  const messages: Message[] = [{ role: "user", content: [{ type: "text", text: args.request }] }];
  const tools = [...args.tools.specs, FINISH_SPEC];
  let textTurns = 0;
  for (let turn = 0; turn < CONTROL_MAX_TURNS; turn += 1) {
    const response = await args.completer.complete(`ghar/control/${args.caller}`, {
      system: args.charter,
      messages,
      tools,
    });
    messages.push({ role: "assistant", content: response.content });
    const uses = response.content.filter((block) => block["type"] === "tool_use");
    if (uses.length === 0) {
      textTurns += 1;
      if (textTurns >= CONTROL_TEXT_TURNS_MAX) {
        throw new GharError(502, "control_failed", `the model wrote ${textTurns} turns in a row without calling a tool`);
      }
      messages.push({ role: "user", content: [{ type: "text", text: NO_TOOL_NUDGE }] });
      continue;
    }
    textTurns = 0;
    const finish = uses.find((block) => block["name"] === FINISH_TOOL);
    if (finish) {
      const input = finish["input"] as { result?: unknown } | undefined;
      if (typeof input?.result !== "string" || input.result.length === 0) {
        throw new GharError(502, "control_failed", "the model finished without a result");
      }
      return input.result;
    }
    const results: Block[] = [];
    for (const use of uses) {
      results.push(await toolResult(args.tools, use));
    }
    messages.push({ role: "user", content: results });
  }
  throw new GharError(502, "control_failed", `the request did not finish in ${CONTROL_MAX_TURNS} model turns`);
}

/** toolResult runs one tool_use block; a GharError is the tool's error result, anything else is a bug and propagates. */
async function toolResult(tools: ControlTools, use: Block): Promise<Block> {
  const id = String(use["id"]);
  try {
    return { type: "tool_result", tool_use_id: id, content: await tools.call(String(use["name"]), use["input"]), is_error: false };
  } catch (err) {
    if (err instanceof GharError) {
      return { type: "tool_result", tool_use_id: id, content: `${err.type}: ${err.message}`, is_error: true };
    }
    throw err;
  }
}

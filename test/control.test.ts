import assert from "node:assert/strict";
import { test } from "node:test";
import { CONTROL_MAX_TURNS } from "../src/constants.js";
import type { ChatResponse, Completer } from "../src/control/dwar.js";
import { runControl, type ControlTools } from "../src/control/loop.js";
import { ControlRuns } from "../src/control/runs.js";
import { GharError } from "../src/errors.js";

const use = (id: string, name: string, input: unknown): ChatResponse => ({
  content: [{ type: "tool_use", id, name, input }],
  stop_reason: "tool_use",
});

const text: ChatResponse = { content: [{ type: "text", text: "thinking aloud" }], stop_reason: "end_turn" };

/** A completer that answers each turn from the next response in `turns`. */
function scripted(turns: ChatResponse[]): Completer & { calls: number } {
  const completer = {
    calls: 0,
    async complete() {
      const turn = turns[completer.calls] ?? turns.at(-1)!;
      completer.calls += 1;
      return turn;
    },
  };
  return completer;
}

const tools = (call: ControlTools["call"]): ControlTools => ({ specs: [], call });

test("a run returns what the model gives to finish, after running its tool calls", async () => {
  const seen: string[] = [];
  const result = await runControl({
    completer: scripted([use("a", "command_device", { device_id: "d1" }), use("b", "finish", { result: "Kitchen light is off." })]),
    tools: tools(async (name) => {
      seen.push(name);
      return "{}";
    }),
    charter: "charter",
    request: "turn off the kitchen light",
    caller: "health-specialist",
  });
  assert.equal(result, "Kitchen light is off.");
  assert.deepEqual(seen, ["command_device"]);
});

test("a tool's GharError reaches the model as an error result and the run goes on", async () => {
  const requests: unknown[] = [];
  const completer: Completer = {
    async complete(_caller, request) {
      requests.push(structuredClone(request.messages));
      return requests.length === 1 ? use("a", "command_device", {}) : use("b", "finish", { result: "The lamp did not answer." });
    },
  };
  const result = await runControl({
    completer,
    tools: tools(async () => {
      throw new GharError(504, "device_unreachable", "no answer");
    }),
    charter: "c",
    request: "r",
    caller: "x",
  });
  assert.equal(result, "The lamp did not answer.");
  const second = requests[1] as Array<{ content: Array<{ content?: string; is_error?: boolean }> }>;
  assert.deepEqual(second.at(-1)!.content[0], { type: "tool_result", tool_use_id: "a", content: "device_unreachable: no answer", is_error: true });
});

test("a bug in a tool is not an error result: it fails the run", async () => {
  await assert.rejects(
    runControl({
      completer: scripted([use("a", "get_devices", {})]),
      tools: tools(async () => {
        throw new TypeError("broken");
      }),
      charter: "c",
      request: "r",
      caller: "x",
    }),
    TypeError,
  );
});

test("a model that never calls a tool fails the run with control_failed", async () => {
  await assert.rejects(
    runControl({ completer: scripted([text]), tools: tools(async () => "{}"), charter: "c", request: "r", caller: "x" }),
    (err: unknown) => err instanceof GharError && err.type === "control_failed",
  );
});

test("a run that never finishes stops at the turn cap", async () => {
  const completer = scripted([use("a", "get_devices", {})]);
  await assert.rejects(
    runControl({ completer, tools: tools(async () => "{}"), charter: "c", request: "r", caller: "x" }),
    (err: unknown) => err instanceof GharError && err.type === "control_failed",
  );
  assert.equal(completer.calls, CONTROL_MAX_TURNS);
});

test("a run records its result or its error once it settles, and an unknown run is a 404", async () => {
  const runs = new ControlRuns();
  const done = runs.start("a", async () => "ok");
  const failed = runs.start("b", async () => {
    throw new GharError(502, "control_failed", "nope");
  });
  assert.equal(done.status, "running");
  await Promise.all([done.settled, failed.settled]);
  assert.deepEqual([done.status, done.result], ["done", "ok"]);
  assert.deepEqual([failed.status, failed.error], ["failed", { type: "control_failed", message: "nope" }]);
  assert.equal(runs.get(done.id), done);
  assert.throws(() => runs.get("missing"), (err: unknown) => err instanceof GharError && err.statusCode === 404);
});

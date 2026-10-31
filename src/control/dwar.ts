/** Dwar's `POST /chat/complete`, the model call behind a control run. */

import axios, { isAxiosError, type AxiosInstance } from "axios";
import { DWAR_TIMEOUT_MS } from "../constants.js";
import { GharError } from "../errors.js";

/** One content block of a model turn (text, tool_use, tool_result), kept as Dwar returned it. */
export type Block = Record<string, unknown>;

/** One turn of a control run's history, in Dwar's chat shape. */
export type Message = { role: "user" | "assistant"; content: Block[] };

/** A tool as the model sees it. */
export type ToolSpec = { name: string; description: string; input_schema: Record<string, unknown> };

/** What Dwar returns for one model turn. */
export type ChatResponse = { content: Block[]; stop_reason: string };

/** The model call a control run needs; tests stand in for Dwar by implementing it. */
export type Completer = {
  /** Runs one model turn; `caller` is sent as X-Dadi-Caller so Dwar's inference log attributes the tokens. */
  complete(caller: string, request: { system: string; messages: Message[]; tools: ToolSpec[] }): Promise<ChatResponse>;
};

/** Returns a Completer that calls the Dwar at `baseUrl`. */
export function createDwarClient(baseUrl: string): Completer {
  const http: AxiosInstance = axios.create({ baseURL: baseUrl, timeout: DWAR_TIMEOUT_MS });
  return {
    async complete(caller, request) {
      try {
        const response = await http.post<ChatResponse>(
          "/chat/complete",
          { ...request, tool_choice: "auto" },
          { headers: { "X-Dadi-Caller": caller } },
        );
        return response.data;
      } catch (err) {
        if (isAxiosError(err)) {
          const detail = err.response ? `dwar ${err.response.status}: ${JSON.stringify(err.response.data)}` : `dwar unreachable: ${err.message}`;
          throw new GharError(502, "dwar_failed", detail);
        }
        throw err;
      }
    },
  };
}

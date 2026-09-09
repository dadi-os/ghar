/** Full in-memory state cache for widget hydration. */

import type { FastifyInstance } from "fastify";
import { toStateMap } from "../serialize.js";

export async function registerState(app: FastifyInstance): Promise<void> {
  app.get("/state", async () => {
    const snapshot = app.controller.getAllState();
    const devices: Record<string, ReturnType<typeof toStateMap>> = {};
    for (const [deviceId, attrs] of snapshot) {
      devices[deviceId] = toStateMap(attrs);
    }
    return { devices };
  });
}

/** Mount domain HTTP routes at the root. */

import type { FastifyInstance } from "fastify";
import { registerCommission } from "./commission.js";
import { registerDevices } from "./devices.js";
import { registerEvents } from "./events.js";
import { registerRadio } from "./radio.js";
import { registerRooms } from "./rooms.js";
import { registerState } from "./state.js";
import { registerTags } from "./tags.js";

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await registerDevices(app);
  await registerRooms(app);
  await registerTags(app);
  await registerState(app);
  await registerEvents(app);
  await registerCommission(app);
  await registerRadio(app);
}

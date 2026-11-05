/** Mount domain HTTP routes at the root. */

import type { FastifyInstance } from "fastify";
import { registerChanges } from "./changes.js";
import { registerCommission } from "./commission.js";
import { registerControl } from "./control.js";
import { registerDevices } from "./devices.js";
import { registerEvents } from "./events.js";
import { registerRadio } from "./radio.js";
import { registerState } from "./state.js";
import { registerTags } from "./tags.js";

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await registerChanges(app);
  await registerDevices(app);
  await registerTags(app);
  await registerState(app);
  await registerEvents(app);
  await registerCommission(app);
  await registerControl(app);
  await registerRadio(app);
}

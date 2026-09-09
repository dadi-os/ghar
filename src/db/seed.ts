import type { Db } from "./client.js";
import { rooms } from "./schema.js";

/** Idempotent seed of the default room for newly commissioned devices. */
export async function seed(db: Db): Promise<void> {
  await db.insert(rooms).values({ name: "unassigned" }).onConflictDoNothing({ target: rooms.name });
}

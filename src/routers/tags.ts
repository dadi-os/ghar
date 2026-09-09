/** Tag list with device counts. Writes happen via device patch. */

import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { tags } from "../db/schema.js";
import { toTagRecord } from "../serialize.js";

export async function registerTags(app: FastifyInstance): Promise<void> {
  app.get("/tags", async () => {
    const rows = await app.db
      .select({
        id: tags.id,
        name: tags.name,
        deviceCount: sql<number>`(
          SELECT count(*)::int FROM device_tags WHERE device_tags.tag_id = ${tags.id}
        )`,
      })
      .from(tags);
    return { tags: rows.map(toTagRecord) };
  });
}

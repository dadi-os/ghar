/** Tag writes shared by the device, tag and commissioning paths. */

import { eq, sql } from "drizzle-orm";
import { GharError } from "../errors.js";
import type { Db } from "./client.js";
import { deviceTags, tags } from "./schema.js";

/** True when a unique-violation style postgres error mentions the given constraint fragment. */
export function isUniqueViolation(err: unknown, fragment?: string): boolean {
  const message = err instanceof Error ? `${err.message} ${err.cause instanceof Error ? err.cause.message : ""}` : "";
  if (!/unique|duplicate/i.test(message)) {
    return false;
  }
  if (fragment && !message.includes(fragment)) {
    return false;
  }
  return true;
}

/** The tag with this name, created when it does not exist yet. */
export async function findOrCreateTag(db: Db, name: string): Promise<{ id: string; name: string }> {
  const found = await db.select().from(tags).where(eq(tags.name, name));
  if (found[0]) {
    return found[0];
  }
  try {
    const inserted = await db.insert(tags).values({ name }).returning();
    if (inserted[0]) {
      return inserted[0];
    }
  } catch (err) {
    if (!isUniqueViolation(err)) {
      throw err;
    }
  }
  const raced = await db.select().from(tags).where(eq(tags.name, name));
  if (!raced[0]) {
    throw new GharError(500, "internal_error", `failed to create tag ${name}`);
  }
  return raced[0];
}

/** Put the device under each named tag, creating tags as needed; tags it already has are kept. */
export async function addDeviceTags(db: Db, deviceId: string, names: readonly string[]): Promise<void> {
  for (const name of names) {
    const tag = await findOrCreateTag(db, name);
    await db.insert(deviceTags).values({ deviceId, tagId: tag.id }).onConflictDoNothing();
  }
}

/** A tag with no devices has no meaning here, so it is removed. */
export async function deleteOrphanTags(db: Db): Promise<void> {
  await db.execute(sql`DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM device_tags)`);
}

/** Tag writes shared by the device, tag and commissioning paths. */

import { and, eq, inArray, sql } from "drizzle-orm";
import { GharError } from "../errors.js";
import type { Db } from "./client.js";
import { deviceTags, devices, tags } from "./schema.js";

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

/** Every id must name a device, or the whole request is a 404. */
export async function requireDevices(db: Db, ids: string[]): Promise<void> {
  const found = await db.select({ id: devices.id }).from(devices).where(inArray(devices.id, ids));
  if (found.length !== new Set(ids).size) {
    throw new GharError(404, "not_found", "device not found");
  }
}

/** Put the devices under the tag named `name`, making the tag when it does not exist. */
export async function tagDevices(db: Db, name: string, deviceIds: string[]): Promise<void> {
  await requireDevices(db, deviceIds);
  const tag = await findOrCreateTag(db, name);
  for (const deviceId of deviceIds) {
    await db.insert(deviceTags).values({ deviceId, tagId: tag.id }).onConflictDoNothing();
  }
}

/** Take the devices out of the tag named `name`; the tag goes with its last device. */
export async function untagDevices(db: Db, name: string, deviceIds: string[]): Promise<void> {
  const found = await db.select().from(tags).where(eq(tags.name, name));
  const tag = found[0];
  if (!tag) {
    throw new GharError(404, "not_found", `no tag named ${name}`);
  }
  await db.delete(deviceTags).where(and(eq(deviceTags.tagId, tag.id), inArray(deviceTags.deviceId, deviceIds)));
  await deleteOrphanTags(db);
}

/** Rename the tag `name`; a name another tag already has is a 409. */
export async function renameTagByName(db: Db, name: string, next: string): Promise<void> {
  const found = await db.select().from(tags).where(eq(tags.name, name));
  const tag = found[0];
  if (!tag) {
    throw new GharError(404, "not_found", `no tag named ${name}`);
  }
  try {
    await db.update(tags).set({ name: next }).where(eq(tags.id, tag.id));
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new GharError(409, "conflict", `tag name already exists: ${next}`);
    }
    throw err;
  }
}

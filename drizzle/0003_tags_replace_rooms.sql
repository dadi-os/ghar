INSERT INTO "tags" ("name")
SELECT "name" FROM "rooms" WHERE "name" <> 'unassigned'
ON CONFLICT ("name") DO NOTHING;--> statement-breakpoint
INSERT INTO "device_tags" ("device_id", "tag_id")
SELECT "devices"."id", "tags"."id"
FROM "devices"
JOIN "rooms" ON "rooms"."id" = "devices"."room_id"
JOIN "tags" ON "tags"."name" = "rooms"."name"
WHERE "rooms"."name" <> 'unassigned'
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "devices" DROP CONSTRAINT "devices_room_id_rooms_id_fk";
--> statement-breakpoint
ALTER TABLE "devices" DROP COLUMN "room_id";--> statement-breakpoint
ALTER TABLE "rooms" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "rooms" CASCADE;

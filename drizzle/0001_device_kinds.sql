CREATE TYPE "public"."device_kind" AS ENUM('light', 'plug', 'switch', 'cover', 'fan', 'air_purifier', 'thermostat', 'air_conditioner', 'heat_pump', 'water_heater', 'lock', 'contact', 'occupancy', 'light_sensor', 'temperature', 'humidity', 'pressure', 'flow', 'leak', 'freeze', 'rain', 'air_quality', 'smoke_alarm', 'energy_meter', 'solar', 'battery_storage', 'ev_charger', 'valve', 'irrigation', 'pump', 'robot_vacuum', 'washer', 'dryer', 'dishwasher', 'refrigerator', 'cabinet', 'oven', 'cooktop', 'microwave', 'extractor_hood', 'speaker', 'tv', 'camera', 'doorbell', 'bridge', 'other');--> statement-breakpoint
ALTER TABLE "device_capabilities" ALTER COLUMN "capability" SET DATA TYPE text;--> statement-breakpoint
UPDATE "device_capabilities" SET "capability" = CASE "capability" WHEN 'switchable' THEN 'on_off' WHEN 'dimmable' THEN 'level' WHEN 'colorable' THEN 'color' WHEN 'lockable' THEN 'lock' ELSE "capability" END;--> statement-breakpoint
DROP TYPE "public"."device_capability";--> statement-breakpoint
CREATE TYPE "public"."device_capability" AS ENUM('on_off', 'level', 'color', 'cover', 'fan', 'thermostat', 'lock', 'sensor', 'button', 'alarm', 'power_source', 'energy', 'valve', 'rvc', 'appliance', 'mode', 'temperature_control', 'media', 'camera');--> statement-breakpoint
ALTER TABLE "device_capabilities" ALTER COLUMN "capability" SET DATA TYPE "public"."device_capability" USING "capability"::"public"."device_capability";--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "kind" "device_kind";--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "device_types" integer[];--> statement-breakpoint
UPDATE "devices" SET "device_types" = '{}', "kind" = CASE
  WHEN EXISTS (SELECT 1 FROM "device_capabilities" c WHERE c."device_id" = "devices"."id" AND c."capability" IN ('color', 'level')) THEN 'light'::"device_kind"
  WHEN EXISTS (SELECT 1 FROM "device_capabilities" c WHERE c."device_id" = "devices"."id" AND c."capability" = 'lock') THEN 'lock'::"device_kind"
  WHEN EXISTS (SELECT 1 FROM "device_capabilities" c WHERE c."device_id" = "devices"."id" AND c."capability" = 'thermostat') THEN 'thermostat'::"device_kind"
  ELSE 'other'::"device_kind"
END;--> statement-breakpoint
ALTER TABLE "devices" ALTER COLUMN "kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ALTER COLUMN "device_types" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "bridge_name" text;
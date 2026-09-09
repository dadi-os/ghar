CREATE TYPE "public"."device_capability" AS ENUM('switchable', 'dimmable', 'colorable', 'sensor', 'lockable', 'media', 'thermostat');--> statement-breakpoint
CREATE TYPE "public"."event_cause" AS ENUM('agent', 'user', 'external');--> statement-breakpoint
CREATE TABLE "device_capabilities" (
	"device_id" uuid NOT NULL,
	"capability" "device_capability" NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "device_capabilities_device_id_capability_pk" PRIMARY KEY("device_id","capability")
);
--> statement-breakpoint
CREATE TABLE "device_tags" (
	"device_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "device_tags_device_id_tag_id_pk" PRIMARY KEY("device_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" bigint NOT NULL,
	"endpoint" integer NOT NULL,
	"name" text NOT NULL,
	"room_id" uuid NOT NULL,
	"online" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"vendor_name" text,
	"product_name" text
);
--> statement-breakpoint
CREATE TABLE "event_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"device_id" uuid NOT NULL,
	"attribute_key" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"cause" "event_cause" NOT NULL,
	"cause_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "device_capabilities" ADD CONSTRAINT "device_capabilities_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_tags" ADD CONSTRAINT "device_tags_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_tags" ADD CONSTRAINT "device_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_logs" ADD CONSTRAINT "event_logs_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "devices_node_id_endpoint_idx" ON "devices" USING btree ("node_id","endpoint");--> statement-breakpoint
CREATE INDEX "event_logs_created_at_idx" ON "event_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "event_logs_device_id_created_at_idx" ON "event_logs" USING btree ("device_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rooms_name_idx" ON "rooms" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_name_idx" ON "tags" USING btree ("name");
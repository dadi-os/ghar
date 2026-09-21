/** Request body / param / query zod schemas and parse helpers. */

import { z, type ZodError, type ZodType } from "zod";
import { GharError } from "../errors.js";

/** Parse with zod; map failures to `422 invalid_request`. */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new GharError(422, "invalid_request", formatZod(parsed.error));
  }
  return parsed.data;
}

/** Flatten zod issues into a single semicolon-joined message. */
export function formatZod(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const loc = issue.path.join(".");
      return loc ? `${loc}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

export const idParam = z.object({ id: z.string().uuid() }).strict();

export const jobIdParam = z.object({ jobId: z.string().uuid() }).strict();

const capability = z.enum([
  "switchable",
  "dimmable",
  "colorable",
  "sensor",
  "lockable",
  "media",
  "thermostat",
]);

export const devicesQuery = z
  .object({
    room: z.string().min(1).optional(),
    tag: z.string().min(1).optional(),
    capability: capability.optional(),
  })
  .strict();

export const patchDeviceBody = z
  .object({
    name: z.string().min(1).optional(),
    room: z.string().uuid().optional(),
    tags: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const commandBody = z
  .object({
    capability: capability,
    params: z.record(z.unknown()),
    cause: z.enum(["agent", "user"]).optional(),
    cause_ref: z.string().min(1).optional(),
  })
  .strict();

export const createRoomBody = z
  .object({
    name: z.string().min(1),
  })
  .strict();

export const patchRoomBody = z
  .object({
    name: z.string().min(1),
  })
  .strict();

export const commissionBody = z
  .object({
    code: z.string().min(1),
    room_id: z.string().uuid().optional(),
    radio: z.enum(["network", "nearby"]).optional(),
    wifi: z
      .object({
        ssid: z.string().min(1),
        password: z.string(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.radio === "nearby" && value.wifi === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["wifi"],
        message: "nearby commissioning requires wifi",
      });
    }
  });

export const radioPollQuery = z
  .object({
    session_id: z.string().uuid(),
    wait_ms: z.coerce.number().int().min(0).max(25_000).optional(),
  })
  .strict();

export const radioSessionBody = z
  .object({
    session_id: z.string().uuid(),
  })
  .strict();

export const radioReplyBody = z
  .object({
    session_id: z.string().uuid(),
    id: z.number().int().positive(),
    ok: z.boolean(),
    result: z.unknown().optional(),
    error: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.ok && value.error === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["error"],
        message: "a failed radio reply requires error",
      });
    }
  });

export const radioEventBody = z
  .object({
    session_id: z.string().uuid(),
    kind: z.enum(["advertisement", "notification", "disconnected"]),
    address: z.string().min(1),
    value_b64: z.string().optional(),
  })
  .strict();

const uuidOrUuidList = z.union([z.string().uuid(), z.array(z.string().uuid())]);

export const eventsQuery = z
  .object({
    device_id: uuidOrUuidList.optional(),
    room: z.string().min(1).optional(),
    tag: z.string().min(1).optional(),
    key: z.string().min(1).optional(),
    since: z.string().min(1).optional(),
    until: z.string().datetime({ offset: true }).optional(),
    cause: z.enum(["agent", "user", "external"]).optional(),
    limit: z.coerce.number().int().positive().optional(),
    order: z.enum(["asc", "desc"]).optional(),
  })
  .strict();

export function asStringList(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return Array.isArray(value) ? value : [value];
}

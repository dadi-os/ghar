/**
 * Topology. Identical in dev and prod — Nas's proxy resolves these names in both.
 * Not configurable, deliberately.
 */
export const HOST = "0.0.0.0";
export const PORT = 8080;
export const LOG_LEVEL = "info";

/** Wall-clock budget for a single device cluster command. */
export const DEVICE_OPERATION_TIMEOUT_MS = 5_000;

/** How long a Ghar-issued command may claim a matching subscription report. */
export const PENDING_CAUSE_TTL_MS = 5_000;

/** Admin fabric label written onto commissioned peers. */
export const ADMIN_FABRIC_LABEL = "Northwind";

/** Controller node id within the Matter storage namespace. */
export const CONTROLLER_NODE_ID = "ghar";

/** Seeded room name; cannot be renamed or deleted. */
export const UNASSIGNED_ROOM = "unassigned";

/** Most model turns one control run may take before it fails. */
export const CONTROL_MAX_TURNS = 12;

/** Most consecutive model turns without a tool call before a control run fails. */
export const CONTROL_TEXT_TURNS_MAX = 2;

/** Wall-clock budget for one model call from a control run; Dwar retries transient provider failures itself. */
export const DWAR_TIMEOUT_MS = 120_000;

/** How long a finished control run stays readable at GET /control/:id. */
export const CONTROL_RETAIN_MS = 60 * 60 * 1000;

/** Most finished control runs kept for GET /control/:id. */
export const CONTROL_RETAIN_MAX = 200;

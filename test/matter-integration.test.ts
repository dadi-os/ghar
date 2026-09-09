/**
 * Matter simulation findings for CI.
 *
 * Investigated standing up a matter.js ServerNode On/Off device and commissioning
 * it from a ServerNode+ControllerBehavior controller (same process and same-host
 * child process). Device mode can come online, but controller commissioning does
 * not complete reliably — CASE/session establishment hangs and teardown can hang
 * the Node event loop. Do not fake end-to-end coverage. Hardware acceptance on
 * the Linux box is the fabric I/O coverage for this prompt.
 */

import { test } from "node:test";

test("in-process Matter controller↔device commissioning", (t) => {
  t.skip(
    "Not CI-viable: same-process/same-host matter.js controller commissioning hangs on CASE/session; hardware acceptance covers fabric I/O.",
  );
});

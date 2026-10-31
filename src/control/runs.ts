/** Control runs: each request's loop, kept so a caller that stopped waiting can read the outcome later. */

import { randomUUID } from "node:crypto";
import { CONTROL_RETAIN_MAX, CONTROL_RETAIN_MS } from "../constants.js";
import { GharError } from "../errors.js";

/** One control run. `status` leaves "running" once, with `result` on "done" or `error` on "failed". */
export type ControlRun = {
  id: string;
  caller: string;
  status: "running" | "done" | "failed";
  result?: string;
  error?: { type: string; message: string };
  /** Resolves when the run leaves "running"; never rejects. */
  settled: Promise<void>;
  finishedAt?: number;
};

/** ControlRuns holds running and recently finished control runs in memory; a restart loses them. */
export class ControlRuns {
  private readonly runs = new Map<string, ControlRun>();

  /** start begins `work` as a new run for `caller` and returns it at once. */
  start(caller: string, work: () => Promise<string>): ControlRun {
    this.prune();
    const run: ControlRun = { id: randomUUID(), caller, status: "running", settled: Promise.resolve() };
    run.settled = work().then(
      (result) => {
        run.status = "done";
        run.result = result;
        run.finishedAt = Date.now();
      },
      (err: unknown) => {
        run.status = "failed";
        run.error =
          err instanceof GharError ? { type: err.type, message: err.message } : { type: "internal_error", message: err instanceof Error ? err.message : String(err) };
        run.finishedAt = Date.now();
      },
    );
    this.runs.set(run.id, run);
    return run;
  }

  /** get returns the run with this id, or a 404 once it is unknown or past its retention. */
  get(id: string): ControlRun {
    const run = this.runs.get(id);
    if (!run) {
      throw new GharError(404, "not_found", "control run not found");
    }
    return run;
  }

  /** prune drops finished runs past their retention, and the oldest finished ones past the cap. */
  private prune(): void {
    const now = Date.now();
    const finished = [...this.runs.values()].filter((run) => run.finishedAt !== undefined);
    for (const run of finished) {
      if (now - run.finishedAt! > CONTROL_RETAIN_MS) {
        this.runs.delete(run.id);
      }
    }
    const kept = finished.filter((run) => this.runs.has(run.id)).sort((a, b) => a.finishedAt! - b.finishedAt!);
    for (const run of kept.slice(0, Math.max(0, kept.length - CONTROL_RETAIN_MAX))) {
      this.runs.delete(run.id);
    }
  }
}

import type { LaneState, RunnerLane } from "@runnerbox/contracts";
import { endOf, type ExplainInput } from "./input.ts";
import { runsOf } from "./runs.ts";
import { jobText, recordName } from "./words.ts";

export const HOUR_MS = 60 * 60_000;

type Span = { state: LaneState; start: number; end: number; job: string | null };

// Each runner's last hour: when it ran a job, stepped aside for memory, was ready, or stopped
// before it took a job. A runner's recorded time is ready time around its job when the job log
// places the job, and all ready time when it was released unused. Anything the records can't
// place stays blank.
export function lanes(input: ExplainInput): RunnerLane[] {
  const { install, now } = input;
  const from = now - HOUR_MS;
  const runs = runsOf(input);
  const iso = (ms: number) => new Date(Math.min(now, Math.max(from, ms))).toISOString();

  return install.kinds.flatMap((kind) =>
    kind.slots.map((slot) => {
      const mine = (event: { runnerType?: string; slot?: number }) => event.runnerType === kind.name && event.slot === slot.slot;
      const recorded = runs.filter((run) => mine(run.event)).flatMap(({ event, record, took }): Span[] => {
        const start = Date.parse(event.startedAt);
        const end = endOf(event);
        if (event.released) return [{ state: "ready", start, end, job: null }];
        if (!took) return [{ state: "failed_start", start, end, job: null }];
        if (!record?.startedAt) return [];
        const jobStart = Date.parse(record.startedAt);
        const jobEnd = record.completedAt ? Date.parse(record.completedAt) : end;
        return [
          { state: "ready", start, end: jobStart, job: null },
          { state: "job", start: jobStart, end: jobEnd, job: recordName(record) },
        ];
      });
      const waits = input.events.flatMap((event): Span[] =>
        event.event === "memory_wait" && mine(event) ? [{ state: "stepped_aside", start: Date.parse(event.startedAt), end: endOf(event), job: null }] : [],
      );
      const since = Date.parse(slot.since);
      const live: Span[] =
        slot.phase === "busy"
          ? [{ state: "job", start: since, end: now, job: slot.job ? jobText(slot.job) : null }]
          : slot.phase === "waiting"
            ? [{ state: "stepped_aside", start: since, end: now, job: null }]
            : slot.phase === "registered" && slot.job !== undefined
              ? [{ state: "ready", start: since, end: now, job: null }]
              : [];
      const spans = [...recorded, ...waits, ...live]
        .filter((span) => span.end > from && (span.end > span.start || span.state === "failed_start"))
        .toSorted((a, b) => a.start - b.start)
        .map((span) => ({ state: span.state, start: iso(span.start), end: iso(span.end), job: span.job }));
      return { kind: kind.name, slot: slot.slot, spans };
    }),
  );
}

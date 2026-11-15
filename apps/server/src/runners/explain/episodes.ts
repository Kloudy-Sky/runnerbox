import type { Episode, EpisodeKind, EpisodeRow } from "@runnerbox/contracts";
import { formatDuration } from "runnerbox/src/tracking/format-report.ts";
import { capitalize, durationMs, isFailure, listed, median, plainDuration, plural } from "../../inbox/jobs.ts";
import { whyFor } from "../../inbox/slots.ts";
import { type ExplainInput, type ImageBuild, type MemoryWait, type RunnerEvent } from "./input.ts";
import { type Run, runsOf } from "./runs.ts";
import { recordName, times } from "./words.ts";

const MINUTE = 60_000;
// Records closer together than this are one thing that happened. Jobs on one kind chain over a
// longer gap, since a push's jobs arrive minutes apart.
const GAP_MS = 10 * MINUTE;
const JOB_GAP_MS = 30 * MINUTE;
// Rows kept under each episode, and episodes kept per install, newest first.
const ROWS = 50;
const EPISODES = 50;
// Job lengths within this factor of each other count as about the same.
const SIMILAR = 1.5;

type Timed = { start: number; end: number };

// Splits `items`, sorted by start, wherever one starts more than `gapMs` after the run before it
// ended.
function chains<T>(items: readonly T[], timed: (item: T) => Timed, gapMs: number): T[][] {
  const sorted = items.toSorted((a, b) => timed(a).start - timed(b).start);
  const out: T[][] = [];
  let end = -Infinity;
  for (const item of sorted) {
    const { start, end: itemEnd } = timed(item);
    if (start - end > gapMs || out.length === 0) out.push([item]);
    else out.at(-1)!.push(item);
    end = Math.max(end, itemEnd);
  }
  return out;
}

const spanOf = (event: { startedAt: string; durationMs: number }): Timed => ({ start: Date.parse(event.startedAt), end: Date.parse(event.startedAt) + event.durationMs });
const iso = (ms: number) => new Date(ms).toISOString();

function episode(kind: EpisodeKind, key: string, spans: readonly Timed[], sentence: string, bad: boolean, rows: readonly EpisodeRow[]): Episode {
  const start = Math.min(...spans.map((span) => span.start));
  const end = Math.max(...spans.map((span) => span.end));
  const newest = rows.toSorted((a, b) => b.at.localeCompare(a.at));
  return { id: `${kind}:${key}:${start}`, kind, startedAt: iso(start), endedAt: iso(end), sentence, bad, rows: newest.slice(0, ROWS), more: Math.max(0, newest.length - ROWS) };
}

const runnerRow = (event: RunnerEvent, what: string): EpisodeRow => ({
  at: event.startedAt,
  kind: event.runnerType ?? null,
  slot: event.slot,
  what,
  runner: event.runner,
  exitCode: event.exitCode,
  durationMs: event.durationMs,
});

const kindsOf = (events: readonly { runnerType?: string }[]) => [...new Set(events.flatMap((event) => (event.runnerType ? [event.runnerType] : [])))].toSorted();
// Kind names are names, so a sentence keeps them as written, even at its start.
const runnersOf = (kinds: readonly string[]) => (kinds.length === 0 ? "Runners" : `${listed(kinds)} runners`);

// Runners stepping aside for memory: waits for memory, and ready runners removed because memory
// dropped. Any kind, since they share the machine.
function steppedAside(events: ExplainInput["events"]): Episode[] {
  const aside = events.filter((event): event is MemoryWait | RunnerEvent => event.event === "memory_wait" || (event.event === "runner" && event.released === "memory"));
  return chains(aside, spanOf, GAP_MS).map((group) => {
    const waits = group.filter((event): event is MemoryWait => event.event === "memory_wait");
    const count = waits.length > 0 ? waits.length : group.length;
    const spans = group.map(spanOf);
    const lasted = Math.max(...spans.map((span) => span.end)) - Math.min(...spans.map((span) => span.start));
    const typical = median(waits.map((wait) => wait.durationMs));
    const each = waits.length === 0 || typical === null ? "" : typical < MINUTE ? " Each time it was under a minute." : ` Each time, a runner waited about ${typical < 1.5 * MINUTE ? "a minute" : plainDuration(typical)}.`;
    const lead = count > 1 && lasted >= MINUTE ? `For ${plainDuration(lasted)}, ${listed(kindsOf(group))} runners` : runnersOf(kindsOf(group));
    const sentence = `${lead} stepped aside ${times(count)} so running jobs had enough memory.${each}`;
    const rows = group.map((event): EpisodeRow => (event.event === "memory_wait"
      ? { at: event.startedAt, kind: event.runnerType ?? null, slot: event.slot, what: "memory wait", runner: null, exitCode: null, durationMs: event.durationMs }
      : runnerRow(event, "released for memory")));
    return episode("stepped_aside", "all", spans, sentence, false, rows);
  });
}

// "linux ran 9 jobs and all passed. The longest took 8m 47s."
function jobsSentence(kind: string, runs: readonly Run[]) {
  const known = runs.flatMap((run) => (run.record ? [run.record] : []));
  const unknown = runs.length - known.length;
  if (known.length === 0) return `${kind} runners took ${plural(runs.length, "job")}. GitHub's results for them aren't synced here.`;
  const passed = known.filter((record) => record.conclusion === "success").length;
  const failed = known.filter(isFailure).length;
  const other = known.length - passed - failed;
  const lengths = known.flatMap((record) => {
    const ms = durationMs(record);
    return ms === null ? [] : [ms];
  });
  const spans = known.flatMap((record) => (record.startedAt && record.completedAt ? [{ start: Date.parse(record.startedAt), end: Date.parse(record.completedAt) }] : []));
  // "At the same time, about N each" only fits jobs that overlapped and took about as long.
  const together =
    spans.length === known.length &&
    known.length > 1 &&
    Math.max(...spans.map((span) => span.start)) < Math.min(...spans.map((span) => span.end)) &&
    Math.max(...lengths) <= SIMILAR * Math.min(...lengths);
  const typical = median(lengths);
  const counts = [
    passed > 0 ? `${passed} passed` : null,
    failed > 0 ? `${failed} failed` : null,
    other > 0 ? `${other} ended another way, such as cancelled` : null,
  ].filter((part) => part !== null).join(", ");
  const jobs = plural(known.length, "job");
  const allPassed = passed === known.length;
  const longest = lengths.length === 0 ? "" : known.length === 1 ? ` It took ${formatDuration(lengths[0]!)}.` : ` The longest took ${formatDuration(Math.max(...lengths))}.`;
  const rest = unknown > 0 ? ` GitHub's results for ${plural(unknown, "more job")} aren't synced here.` : "";
  if (together && typical !== null) return `${kind} ran ${jobs} at the same time, about ${plainDuration(typical)} each. ${allPassed ? "All passed." : `${capitalize(counts)}.`}${rest}`;
  const ran = allPassed ? `${kind} ran ${jobs} and ${known.length === 1 ? "it" : "all"} passed.` : `${kind} ran ${jobs}: ${counts}.`;
  return `${ran}${longest}${rest}`;
}

// The jobs each kind ran, one episode for each stretch of them.
function jobs(runs: readonly Run[]): Episode[] {
  const took = runs.filter((run) => run.took);
  return [...Map.groupBy(took, (run) => run.event.runnerType ?? "default")].flatMap(([kind, own]) =>
    chains(own, (run) => spanOf(run.event), JOB_GAP_MS).map((group) => {
      const failed = group.some((run) => run.record !== null && isFailure(run.record));
      const rows = group.map((run) => {
        const ended = run.record ? (run.record.conclusion ?? "still running") : "result not synced";
        return runnerRow(run.event, run.record ? `${recordName(run.record)}: ${ended}` : "took a job, result not synced");
      });
      return episode("jobs", kind, group.map((run) => spanOf(run.event)), jobsSentence(kind, group), failed, rows);
    }),
  );
}

// Runners that ended with an error before taking a job.
function failing(runs: readonly Run[]): Episode[] {
  const failed = runs.filter((run) => !run.took && !run.event.released);
  return [...Map.groupBy(failed, (run) => run.event.runnerType ?? "default")].flatMap(([kind, own]) =>
    chains(own, (run) => spanOf(run.event), GAP_MS).map((group) => {
      const why = whyFor(group.at(-1)!.event.exitCode);
      const sentence = group.length === 1
        ? `A ${kind} runner stopped before it took a job. ${why}`
        : `${kind} runners stopped ${plural(group.length, "time")} before taking a job. Runnerbox waits before each try. ${why}`;
      return episode("failing", kind, group.map((run) => spanOf(run.event)), sentence, true, group.map((run) => runnerRow(run.event, "stopped before taking a job")));
    }),
  );
}

// Ready runners restarted so the next job gets a new image.
function newImage(events: ExplainInput["events"]): Episode[] {
  const released = events.filter((event): event is RunnerEvent => event.event === "runner" && event.released === "image");
  return [...Map.groupBy(released, (event) => event.runnerType ?? "default")].flatMap(([kind, own]) =>
    chains(own, spanOf, GAP_MS).map((group) =>
      episode("new_image", kind, group.map(spanOf), `${kind} runners restarted on a new image.`, false, group.map((event) => runnerRow(event, "released for a new image"))),
    ),
  );
}

// Each image build, with failures in a row on one kind as one.
function builds(events: ExplainInput["events"]): Episode[] {
  const all = events.filter((event): event is ImageBuild => event.event === "image_build");
  return [...Map.groupBy(all, (event) => event.runnerType ?? "default")].flatMap(([kind, own]) => {
    const sorted = own.toSorted((a, b) => a.startedAt.localeCompare(b.startedAt));
    const groups: ImageBuild[][] = [];
    for (const build of sorted) {
      const last = groups.at(-1);
      if (last && !build.ok && !last[0]!.ok) last.push(build);
      else groups.push([build]);
    }
    return groups.map((group) => {
      const first = group[0]!;
      const sentence = first.ok
        ? `The ${kind} image was built in ${formatDuration(first.durationMs)}.`
        : group.length === 1
          ? `The ${kind} image's build failed after ${formatDuration(first.durationMs)}.`
          : `The ${kind} image failed to build ${plural(group.length, "time")}.`;
      const rows = group.map((build): EpisodeRow => ({ at: build.startedAt, kind, slot: null, what: `${build.ok ? "built" : "build failed"} ${build.tag}`, runner: null, exitCode: null, durationMs: build.durationMs }));
      return episode("build", kind, group.map(spanOf), sentence, !first.ok, rows);
    });
  });
}

// What happened on one install, newest first, each stretch of related records as one sentence.
export function episodes(input: Pick<ExplainInput, "events" | "jobs">): Episode[] {
  const runs = runsOf(input);
  return [...steppedAside(input.events), ...jobs(runs), ...failing(runs), ...newImage(input.events), ...builds(input.events)]
    .toSorted((a, b) => b.endedAt.localeCompare(a.endedAt))
    .slice(0, EPISODES);
}


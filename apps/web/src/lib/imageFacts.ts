import type { KindState, LauncherEvent } from "@runnerbox/contracts";
import { formatAge } from "./format.ts";

const DAY_MS = 86_400_000;

export type ImageStatus = {
  word: string;
  tone: "success" | "warning" | "destructive" | "muted";
  sentence: string;
  // How far a build is through its typical length, held under 1, or null when there's no history.
  progress: number | null;
};

// One kind's image in a word and a sentence, for someone who has never heard of a Docker image.
// Null when Runnerbox on the machine reports nothing about it yet.
export function imageStatus(kind: typeof KindState.Type, now: number, typicalBuildMs: number | null): ImageStatus | null {
  const age = (iso: string) => ageWords(iso, now);
  if (kind.building && kind.buildingSince) {
    const elapsed = now - Date.parse(kind.buildingSince);
    const typical = typicalBuildMs ? `, typically ${minutes(typicalBuildMs)}` : "";
    return {
      word: kind.image ? "Rebuilding" : "Building",
      tone: "warning",
      sentence: `${minutes(elapsed)} in${typical}. ${kind.image ? "Jobs keep the current image until it's done." : "Jobs start once it's done."}`,
      progress: typicalBuildMs ? Math.min(0.95, elapsed / typicalBuildMs) : null,
    };
  }
  if (kind.buildFailedAt) {
    return {
      word: kind.image ? "Rebuild failed" : "Build failed",
      tone: "destructive",
      sentence: kind.image && kind.builtAt
        ? `Jobs still run on the one from ${age(kind.builtAt)}. Runnerbox tries again within 5 minutes.`
        : "These runners take no jobs until a build works. Runnerbox tries again within 5 minutes.",
      progress: null,
    };
  }
  if (!kind.builtAt) return null;
  if (!kind.rebuildDays) {
    return { word: `Built ${age(kind.builtAt)}`, tone: "muted", sentence: "Rebuilt only when its files change.", progress: null };
  }
  if (now - Date.parse(kind.builtAt) < kind.rebuildDays * DAY_MS) {
    return { word: "Fresh", tone: "success", sentence: `Rebuilt ${age(kind.builtAt)}, next ${nextWords(kind.rebuildDays, now)}.`, progress: null };
  }
  return { word: "Rebuild due", tone: "warning", sentence: `Built ${age(kind.builtAt)}. It rebuilds once the machine has room.`, progress: null };
}

const minutes = (ms: number) => `${Math.max(1, Math.round(ms / 60_000))}m`;

function ageWords(iso: string, now: number) {
  const days = Math.floor((now - Date.parse(iso)) / DAY_MS);
  return days === 0 ? "today" : days === 1 ? "yesterday" : days < 14 ? `${days} days ago` : `${formatAge(iso, now)} ago`;
}

// Periods count from the epoch, the same way the machine picks a new tag.
function nextWords(rebuildDays: number, now: number) {
  const period = rebuildDays * DAY_MS;
  const next = new Date((Math.floor(now / period) + 1) * period);
  const days = (next.getTime() - now) / DAY_MS;
  if (days < 1 && next.getDate() === new Date(now).getDate()) return "later today";
  if (days < 6) return `on ${next.toLocaleDateString(undefined, { weekday: "long" })}`;
  return `on ${next.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

// The typical length of a kind's successful image builds, or null with none on record.
export function typicalBuildMs(events: ReadonlyArray<LauncherEvent>, install: string, kind: string) {
  const durations = events
    .flatMap((event) => (event.event === "image_build" && event.ok && event.install === install && event.runnerType === kind ? [event.durationMs] : []))
    .toSorted((a, b) => a - b);
  return durations.length === 0 ? null : (durations[Math.floor(durations.length / 2)] ?? null);
}

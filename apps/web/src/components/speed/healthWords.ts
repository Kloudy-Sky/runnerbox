import type { HealthDay, MachineHealth } from "@runnerbox/contracts";
import { formatMiB } from "../../lib/format.ts";

export type Tone = "bad" | "warn" | "muted";

// A VM this short of memory is close to the kernel killing a job, whatever the pause line says.
const NEARLY_OUT_MIB = 256;
const WEEK = 7;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

// How a day's lowest free memory reads against the line runners pause below: fine, below the line
// (new jobs waited), or nearly out.
export function memoryTone(lowestMiB: number | null, pauseBelowMiB: number | null): Tone | null {
  if (lowestMiB === null) return null;
  if (lowestMiB < Math.max(NEARLY_OUT_MIB, (pauseBelowMiB ?? 0) / 4)) return "bad";
  if (pauseBelowMiB !== null && lowestMiB < pauseBelowMiB) return "warn";
  return null;
}

const sum = (days: readonly HealthDay[], count: (day: HealthDay) => number) => days.reduce((total, day) => total + count(day), 0);

// A machine's last days in a word or two beside its name, and one plain sentence on what's going
// on. Off is normal, as a laptop at night, so it never reads as a fault; only `down` days, memory
// that ran short and jobs the machine failed do.
export function describeHealth({ pauseBelowMiB, days }: MachineHealth): { status: { text: string; tone: Tone } | null; sentence: string } {
  const today = days.at(-1);
  const before = days.slice(0, -1);
  const week = days.slice(-WEEK);
  const tones = days.map((day) => memoryTone(day.lowestVmFreeMiB, pauseBelowMiB));
  const nearlyOut = tones.filter((tone) => tone === "bad").length;
  const short = tones.filter((tone) => tone !== null).length;
  const failed = sum(days, (day) => day.failedByMachine);
  const failedThisWeek = sum(week, (day) => day.failedByMachine);
  const downBefore = before.filter((day) => day.uptime === "down").length;
  const off = days.filter((day) => day.uptime === "off").length;

  if (!today || off === days.length) return { status: { text: "Off", tone: "muted" }, sentence: `It hasn't run in the last ${plural(days.length, "day")}.` };

  const parts: string[] = [];
  if (today.uptime === "down") {
    parts.push(today.failedBeforeJob > 0 ? `It isn't taking jobs today: ${plural(today.failedBeforeJob, "runner")} failed before reaching one.` : "It isn't taking jobs today.");
  }
  if (downBefore > 0) parts.push(`It stopped taking jobs for a stretch on ${plural(downBefore, "day")}.`);
  if (nearlyOut > 0) parts.push(`Free memory nearly ran out on ${plural(nearlyOut, "day")}.`);
  else if (short > 0 && pauseBelowMiB !== null) parts.push(`Free memory fell below ${formatMiB(pauseBelowMiB)} on ${plural(short, "day")}, and new jobs waited then.`);
  if (failed > 0) parts.push(`${plural(failed, "job")} failed because of the machine${failedThisWeek === failed ? ", all this week" : ""}.`);
  if (parts.length === 0) parts.push("It took jobs every day it was on.");
  if (off > 0 && today.uptime !== "down" && downBefore === 0) parts.push(`Off on ${plural(off, "day")}, which is normal for a machine that sleeps.`);

  const status =
    today.uptime === "down"
      ? { text: "Stopped today", tone: "bad" as const }
      : nearlyOut > 0 || short > 0
        ? { text: "Tight on memory", tone: "warn" as const }
        : today.uptime === "off"
          ? { text: "Off today", tone: "muted" as const }
          : null;
  // Two facts at most, so the row stays one line or two.
  return { status, sentence: parts.slice(0, 2).join(" ") };
}

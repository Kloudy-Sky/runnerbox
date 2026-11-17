import type { DayUptime, HealthDay } from "@runnerbox/contracts";
import { cn } from "../../lib/utils.ts";
import { shortDay } from "./shortDay.ts";

// Off is drawn dark, not red: a machine that sleeps is off every night and that's no fault. A day
// taken in part is the same green, fainter, since it took every job it was on for.
export const UPTIME_STYLE: Record<DayUptime, { readonly className: string; readonly words: string }> = {
  up: { className: "bg-success", words: "took jobs all day" },
  partial: { className: "bg-success/45", words: "took jobs part of the day, off the rest" },
  down: { className: "bg-destructive", words: "stopped taking jobs for a stretch" },
  off: { className: "bg-white/10", words: "off" },
};

// One cell per day, oldest first, with days before the machine's records begin left empty.
export function UptimeStrip({ days, length }: { readonly days: readonly HealthDay[]; readonly length: number }) {
  const shown = days.slice(-length);
  return (
    <div className="flex h-4 gap-0.5" role="img" aria-label={`Taking jobs, the last ${length} days`}>
      {Array.from({ length: length - shown.length }, (_, index) => (
        <span key={`empty${index}`} className="flex-1" />
      ))}
      {shown.map((day) => (
        <span key={day.day} title={`${shortDay(day.day)}: ${UPTIME_STYLE[day.uptime].words}`} className={cn("flex-1 rounded-[2px] hover:opacity-80", UPTIME_STYLE[day.uptime].className)} />
      ))}
    </div>
  );
}

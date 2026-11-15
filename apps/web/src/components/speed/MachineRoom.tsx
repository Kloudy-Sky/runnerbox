import type { MachineFit, MachineSample } from "@runnerbox/contracts";
import { formatMiB } from "../../lib/format.ts";
import { ResourceChart } from "../job/ResourceChart.tsx";

const DAY_MS = 24 * 60 * 60_000;
const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

// Each machine's free memory in its VM over the window, with the memory Runnerbox keeps free as a
// dashed line when the machine records it, and the server's sentence about whether it had room.
export function MachineRoom({ fits, samples, days, now }: { readonly fits: readonly MachineFit[]; readonly samples: readonly MachineSample[]; readonly days: number; readonly now: number }) {
  const start = now - days * DAY_MS;
  return (
    <div className="flex flex-col gap-5">
      {fits.map((fit) => {
        const points = samples.flatMap((sample) =>
          sample.install === fit.install && sample.vm ? [{ offsetMs: Date.parse(sample.time) - start, value: sample.vm.availableMiB }] : [],
        );
        const total = fit.totalMiB ?? 0;
        return (
          <section key={fit.install} className="flex flex-col gap-1.5">
            {fits.length > 1 ? <h3 className="font-medium">{fit.install}</h3> : null}
            {points.length >= 2 && total > 0 ? (
              <ResourceChart
                label={`Memory free in ${fit.install}'s VM over the window`}
                points={points}
                durationMs={days * DAY_MS}
                max={total}
                ticks={[0, total / 2, total]}
                limit={fit.floorMiB ? { value: fit.floorMiB, label: `kept free ${formatMiB(fit.floorMiB)}` } : null}
                mark={null}
                format={formatMiB}
                describe={(offsetMs) => new Date(start + offsetMs).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}
                edges={[day(start), "now"]}
              />
            ) : null}
            <p className="text-foreground/90">{fit.sentence}</p>
          </section>
        );
      })}
    </div>
  );
}

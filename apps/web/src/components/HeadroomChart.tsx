import type { MachineSample } from "@runnerbox/contracts";
import { formatMiB } from "../lib/format.ts";

const HEIGHT = 120;

// One install's VM over the range: memory available (blue) and swap in use (amber), both against
// the VM's total, so a line near the bottom is a machine near its end.
export function HeadroomChart({ samples, days }: { samples: readonly MachineSample[]; days: number }) {
  const vm = samples.filter((sample) => sample.vm);
  if (vm.length < 2) return <p className="text-dim">No VM samples in this range.</p>;
  const total = Math.max(...vm.map((sample) => sample.vm!.totalMiB));
  const now = Date.now();
  const start = now - days * 24 * 60 * 60_000;
  const x = (time: string) => Math.max(0, ((Date.parse(time) - start) / (now - start)) * 1000);
  const y = (mib: number) => HEIGHT - (mib / total) * HEIGHT;
  const line = (pick: (sample: MachineSample) => number) => vm.map((sample) => `${x(sample.time)},${y(pick(sample))}`).join(" ");
  const lowest = vm.reduce((low, sample) => (sample.vm!.availableMiB < low.vm!.availableMiB ? sample : low));
  return (
    <div>
      <svg viewBox={`0 0 1000 ${HEIGHT}`} preserveAspectRatio="none" className="block h-[120px] w-full">
        <polyline points={line((sample) => sample.vm!.availableMiB)} fill="none" stroke="var(--color-blue)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
        <polyline points={line((sample) => sample.vm!.swapUsedMiB)} fill="none" stroke="var(--color-amber)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex gap-4 text-dim">
        <span><span className="text-blue">available</span> and <span className="text-amber">swap</span> of {formatMiB(total)}</span>
        <span className="flex-1" />
        <span>lowest {formatMiB(lowest.vm!.availableMiB)} at {new Date(lowest.time).toLocaleString()}</span>
      </div>
    </div>
  );
}

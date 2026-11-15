import type { CostEstimate } from "@runnerbox/contracts";

// GitHub's published per-minute prices for its hosted runners, copied by hand from the page below
// on the date below. The page gives no date of its own. Update both together, never from memory.
export const PRICES_SOURCE = "https://docs.github.com/en/billing/reference/actions-runner-pricing";
export const PRICES_READ_ON = "2026-11-15";

// Linux x64, smallest first: the standard 2-core runner, then the larger runners.
const LINUX_X64 = [
  { cores: 2, usdPerMinute: 0.006 },
  { cores: 4, usdPerMinute: 0.012 },
  { cores: 8, usdPerMinute: 0.022 },
  { cores: 16, usdPerMinute: 0.042 },
  { cores: 32, usdPerMinute: 0.082 },
  { cores: 64, usdPerMinute: 0.162 },
  { cores: 96, usdPerMinute: 0.252 },
] as const;
// The standard macOS runner, 3 or 4 cores.
const MACOS = { usdPerMinute: 0.062 } as const;

// Where a kind's jobs ran, which picks the hosted runner to compare with.
export type Priced = { readonly runsIn: "container" | "job_vm" | "host"; readonly cpus: number | null };

// Prices job minutes, each job rounded up to a whole minute as GitHub bills, at the smallest hosted
// runner with at least the kind's CPUs. Host installs run on a Mac's own OS, so they're priced as
// macOS. A kind with no recorded CPU limit, or more CPUs than any hosted size, gets none.
export function estimateCost(jobMs: readonly number[], { runsIn, cpus }: Priced): CostEstimate | null {
  const minutes = jobMs.reduce((sum, ms) => sum + Math.ceil(ms / 60_000), 0);
  const priced = (usdPerMinute: number, size: string): CostEstimate => ({ usd: Math.round(minutes * usdPerMinute * 100) / 100, minutes, size, usdPerMinute });
  if (runsIn === "host") return priced(MACOS.usdPerMinute, "standard macOS");
  if (cpus === null) return null;
  const size = LINUX_X64.find((each) => each.cores >= cpus);
  return size ? priced(size.usdPerMinute, `${size.cores}-core Linux`) : null;
}

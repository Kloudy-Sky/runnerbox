import type { LauncherEvent } from "./launcher-event.ts";
import { percentile } from "./report.ts";

export type LauncherRow = {
  install: string;
  runnerType: string;
  runners: number;
  // Containers that ended non-zero or lost SSH, not counting ones the slot removed on purpose.
  failedRunners: number;
  releasedForMemory: number;
  releasedForImage: number;
  memoryWaits: number;
  memoryWaitP90Ms: number | null;
  imageBuilds: number;
  failedBuilds: number;
  buildP50Ms: number | null;
};

export function summarizeLauncher(events: readonly { install: string; record: LauncherEvent }[]): LauncherRow[] {
  const groups = Map.groupBy(events, ({ install, record }) => `${install}\0${record.runnerType ?? "-"}`);
  return [...groups.values()].map((group) => {
    const records = group.map(({ record }) => record);
    const runners = records.filter((record) => record.event === "runner");
    const waits = records.filter((record) => record.event === "memory_wait");
    const builds = records.filter((record) => record.event === "image_build");
    return {
      install: group[0]?.install ?? "-",
      runnerType: group[0]?.record.runnerType ?? "-",
      runners: runners.length,
      failedRunners: runners.filter((runner) => !runner.released && runner.exitCode !== 0).length,
      releasedForMemory: runners.filter((runner) => runner.released === "memory").length,
      releasedForImage: runners.filter((runner) => runner.released === "image").length,
      memoryWaits: waits.length,
      memoryWaitP90Ms: percentile(waits.map((wait) => wait.durationMs), 90),
      imageBuilds: builds.length,
      failedBuilds: builds.filter((build) => !build.ok).length,
      buildP50Ms: percentile(builds.filter((build) => build.ok).map((build) => build.durationMs), 50),
    };
  });
}

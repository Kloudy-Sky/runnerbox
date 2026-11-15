import { parseContainer } from "./machine-sample.ts";
import type { ContainerSample } from "./sample-record.ts";

// Only the containers, without /proc, so it stays one quick command. The same 10 second timeout as
// the minute sample's, for a daemon slowed by swapping.
export const CONTAINERS_COMMAND = "timeout 10 docker stats --no-stream --format '{{json .}}'";

type ContainerSamplerActions = {
  // CONTAINERS_COMMAND's output.
  read: () => Promise<string>;
  append: (sample: ContainerSample) => Promise<void>;
  // Whether a container is one of this install's jobs.
  ours: (name: string) => boolean;
  intervalMs: number;
  now: () => number;
  wait: (ms: number) => Promise<void>;
};

// Reads the VM's containers every `intervalMs` while any of this install's job containers exist,
// so a short job gets more than the minute sample's one point. It stops on a read with none of
// them, or that fails, once two intervals have passed since the last `start`: a runner reports
// itself before its container exists, so the first reads after a start may not see it yet.
// `start` while it runs only resets that grace, so reads never overlap.
export function createContainerSampler({ read, append, ours, intervalMs, now, wait }: ContainerSamplerActions) {
  let running = false;
  let startedAt = 0;

  async function loop() {
    for (;;) {
      const started = now();
      const output = await read().catch(() => undefined);
      const containers = output?.split("\n").flatMap((line) => parseContainer(line) ?? []) ?? [];
      const found = containers.some(({ name }) => ours(name));
      if (found) await append({ time: new Date(started).toISOString(), containers });
      else if (now() - startedAt >= 2 * intervalMs) return;
      await wait(Math.max(0, intervalMs - (now() - started)));
    }
  }

  return {
    start() {
      startedAt = now();
      if (running) return;
      running = true;
      void loop().finally(() => (running = false));
    },
  };
}

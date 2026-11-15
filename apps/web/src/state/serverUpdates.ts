import type { UpdateProgress } from "@runnerbox/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { create } from "zustand";
import type { UpdateRun } from "../lib/serverUpdate.ts";
import { runtime } from "../runtime.ts";

// The update each environment's server is going through, by environment ID. Kept here rather
// than in a component, so it outlives the notice while the server restarts and the socket is down.
export const useServerUpdates = create<{ readonly runs: Readonly<Record<string, UpdateRun>> }>()(() => ({ runs: {} }));

const set = (environmentId: string, run: UpdateRun | null) =>
  useServerUpdates.setState(({ runs }) => {
    const { [environmentId]: _, ...rest } = runs;
    return { runs: run === null ? rest : { ...rest, [environmentId]: run } };
  });

export const dismissUpdate = (environmentId: string) => set(environmentId, null);

// An update restarts the server: past this, it isn't coming back on its own soon.
const COME_BACK_MS = 120_000;
const POLL_MS = 1_000;

const errorText = (error: unknown) => (error instanceof Error && error.message ? error.message : "The server didn't start the update.");

const asRun = (version: string, progress: UpdateProgress): UpdateRun =>
  progress._tag === "Downloading"
    ? { step: "downloading", version, received: progress.received, total: progress.total }
    : progress._tag === "Checking"
      ? { step: "checking", version }
      : { step: "starting", version, updateId: progress.updateId };

// How the update with this ID ended, read from whichever server answers next: the old one until it
// stops, then the new one, or the old one again if the new one didn't start.
async function outcome(environmentId: string, version: string, updateId: string): Promise<UpdateRun> {
  const deadline = Date.now() + COME_BACK_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    const status = await runtime.run(environmentId, (client) => client["server.updateStatus"]()).catch(() => null);
    const last = status?.lastUpdate;
    if (last?.id !== updateId || last.status === "pending") continue;
    return last.status === "committed" ? { step: "done", version: last.to } : { step: "rolled-back", version, reason: last.reason ?? null };
  }
  return { step: "lost", version };
}

// Asks the server to update to `version`, follows its steps, then waits through the restart.
export async function startUpdate(environmentId: string, version: string) {
  set(environmentId, { step: "downloading", version, received: 0, total: null });
  let updateId: string | null = null;
  const steps = runtime.run(environmentId, (client) =>
    Stream.runForEach(client["server.update"]({ version }), (progress) =>
      Effect.sync(() => {
        if (progress._tag === "Starting") updateId = progress.updateId;
        set(environmentId, asRun(version, progress));
      }),
    ),
  );
  // Once it's starting, the socket closing under the stream is the restart, not a failure.
  const failed = await steps.then(() => null, (error: unknown) => error);
  if (updateId === null) return set(environmentId, { step: "refused", version, detail: errorText(failed) });
  set(environmentId, await outcome(environmentId, version, updateId));
}

// The environments whose server is restarting on a new version now.
export function useRestarting(): ReadonlySet<string> {
  const runs = useServerUpdates((state) => state.runs);
  return new Set(Object.entries(runs).flatMap(([environmentId, run]) => (run.step === "starting" ? [environmentId] : [])));
}

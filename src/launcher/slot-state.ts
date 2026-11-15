import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type } from "arktype";
import type { Tool } from "../image/tool-probe.ts";

// What each slot of a running `up` is doing now, kept in `<install>/state.json` so a reader such as
// `runnerbox serve` can show it live. Unlike the event log, it says what's happening, not what
// finished. See docs/analytics.md.

export const SLOT_PHASES = ["waiting", "minting", "registered", "busy", "backoff", "stopped"] as const;
export type SlotPhase = (typeof SLOT_PHASES)[number];

const Slot = type({
  slot: "number",
  phase: type.enumerated(...SLOT_PHASES),
  since: "string",
  runner: "string | null",
  detail: "string | null",
});

export const SlotStateFile = type({
  v: "1",
  install: "string",
  pid: "number",
  startedAt: "string",
  updatedAt: "string",
  stopping: "boolean",
  kinds: type({
    name: "string",
    label: "string",
    image: "string | null",
    building: "string | null",
    // What's known about the current image. A file from an older `up` has none of these.
    "buildingSince?": "string | null",
    "buildFailedAt?": "string | null",
    "rebuildDays?": "number | null",
    "builtAt?": "string | null",
    "tools?": type({ name: "string", version: "string | null" }).array().or("null"),
    // Where its jobs run, which says whether they're sampled: only containers in the install's VM
    // are. A file from an older `up` doesn't say.
    "runsIn?": "'container' | 'job_vm' | 'host'",
    slots: Slot.array(),
  }).array(),
});
export type SlotStateFile = typeof SlotStateFile.infer;

export type RunsIn = "container" | "job_vm" | "host";
type Kind = { name: string; label: string; slots: number; image?: string | { rebuildDays?: number }; runsIn?: RunsIn };

// Keeps the file in step with every report. Writes go to a temporary file renamed over the old,
// so a reader never sees half of one, and reports that arrive mid-write are folded into the next.
export function createSlotState(path: string, install: string, kinds: readonly Kind[], now: () => number = Date.now) {
  const iso = () => new Date(now()).toISOString();
  const state: SlotStateFile = {
    v: 1,
    install,
    pid: process.pid,
    startedAt: iso(),
    updatedAt: iso(),
    stopping: false,
    kinds: kinds.map(({ name, label, slots, image, runsIn }) => ({
      name,
      label,
      image: null,
      building: null,
      buildingSince: null,
      buildFailedAt: null,
      rebuildDays: typeof image === "object" ? (image.rebuildDays ?? null) : null,
      builtAt: null,
      tools: null,
      ...(runsIn ? { runsIn } : {}),
      slots: Array.from({ length: slots }, (_, index) => ({ slot: index + 1, phase: "minting" as const, since: iso(), runner: null, detail: null })),
    })),
  };
  let writing: Promise<void> | null = null;
  let dirty = false;

  async function write() {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    while (dirty) {
      dirty = false;
      state.updatedAt = iso();
      await writeFile(`${path}.tmp`, `${JSON.stringify(state)}\n`, { mode: 0o600 });
      await rename(`${path}.tmp`, path);
    }
  }

  // Resolves once the file holds every change made before the call.
  function flush() {
    dirty = true;
    writing ??= write()
      .catch((error: unknown) => console.error(`Couldn't write ${path}: ${error instanceof Error ? error.message : error}`))
      .finally(() => {
        writing = null;
      });
    return writing;
  }

  const kindNamed = (name: string) => state.kinds.find((kind) => kind.name === name);

  return {
    path,
    // Moves a slot to `phase`. `since` changes only when the phase or runner does.
    slot(kindName: string, slot: number, phase: SlotPhase, { runner = null, detail = null }: { runner?: string | null; detail?: string | null } = {}) {
      const entry = kindNamed(kindName)?.slots.find((candidate) => candidate.slot === slot);
      if (!entry) return;
      if (entry.phase !== phase || entry.runner !== runner) entry.since = iso();
      Object.assign(entry, { phase, runner, detail });
      void flush();
    },
    image(kindName: string, image: string | null, building: string | null) {
      const kind = kindNamed(kindName);
      if (!kind) return;
      // A new tag's facts aren't known until it's probed.
      if (image !== kind.image) Object.assign(kind, { builtAt: null, tools: null });
      const buildingSince = building === null ? null : building === kind.building ? kind.buildingSince : iso();
      Object.assign(kind, { image, building, buildingSince });
      void flush();
    },
    // How the last build ended. A failure stays until a build succeeds, while the old image serves.
    built(kindName: string, ok: boolean) {
      const kind = kindNamed(kindName);
      if (!kind) return;
      kind.buildFailedAt = ok ? null : iso();
      void flush();
    },
    // What the probe found in `image`, if it's still the current one.
    probed(kindName: string, image: string, facts: { builtAt: string | null; tools: Tool[] }) {
      const kind = kindNamed(kindName);
      if (!kind || kind.image !== image) return;
      Object.assign(kind, facts);
      void flush();
    },
    stopping() {
      state.stopping = true;
      return flush();
    },
    // Rewrites `updatedAt` with nothing else changed, so a reader can tell a quiet `up` from one
    // that died without stopping its slots.
    heartbeat: flush,
    flush,
  };
}

export type SlotState = ReturnType<typeof createSlotState>;

// Every install's state file under `dir`. A missing or unreadable file is skipped: `up` may not
// have run there, or may be renaming it this instant.
export async function readSlotStates(dir: string) {
  const installs = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const states: SlotStateFile[] = [];
  for (const install of installs.filter((entry) => entry.isDirectory())) {
    const text = await readFile(join(dir, install.name, "state.json"), "utf8").catch(() => "");
    if (!text) continue;
    try {
      const parsed = SlotStateFile(JSON.parse(text));
      if (!(parsed instanceof type.errors)) states.push(parsed);
    } catch {}
  }
  return states;
}

import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type } from "arktype";

// What each slot of a running `up` is doing now, kept in `<install>/state.json` so a reader such as
// runnerbox-server can show it live. Unlike the event log, it says what's happening, not what
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
  kinds: type({ name: "string", label: "string", image: "string | null", building: "string | null", slots: Slot.array() }).array(),
});
export type SlotStateFile = typeof SlotStateFile.infer;

type Kind = { name: string; label: string; slots: number };

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
    kinds: kinds.map(({ name, label, slots }) => ({
      name,
      label,
      image: null,
      building: null,
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
      Object.assign(kind, { image, building });
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

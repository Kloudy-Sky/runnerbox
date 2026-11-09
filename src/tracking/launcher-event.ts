// What `up` records about its own work, one line per finished thing. Times are ISO strings.
export type LauncherEvent =
  // A runner from registration until its container ended. `released` means the slot removed it
  // unused because memory dropped, so its time is waiting, not work.
  | { event: "runner"; slot: number; runner: string; startedAt: string; durationMs: number; exitCode: number | null; released: boolean }
  // A slot waiting for memory before registering.
  | { event: "memory_wait"; slot: number; startedAt: string; durationMs: number }
  | { event: "image_build"; tag: string; startedAt: string; durationMs: number; ok: boolean };

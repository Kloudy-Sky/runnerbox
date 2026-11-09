// What `up` records about its own work, one line per finished thing. Times are ISO strings.
export type LauncherEvent =
  // A runner from registration until its container ended. `released` says why the slot removed it
  // unused, if it did, so its time was waiting, not work.
  | {
      event: "runner";
      slot: number;
      runner: string;
      startedAt: string;
      durationMs: number;
      exitCode: number | null;
      released: false | "memory" | "image";
    }
  // A slot waiting for memory before registering.
  | { event: "memory_wait"; slot: number; startedAt: string; durationMs: number }
  | { event: "image_build"; tag: string; startedAt: string; durationMs: number; ok: boolean };

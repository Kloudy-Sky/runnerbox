import type { SlotPhase } from "@runnerbox/contracts";

// What a runner is doing, in the words someone new to CI reads. The Now view and the Runners page
// both use them, so one machine reads the same on both. `job` is the name its runner said it took,
// when busy.
export function runnerPhase(phase: SlotPhase, job?: string | null) {
  switch (phase) {
    case "registered":
      return { text: "ready", tone: "text-success" };
    case "busy":
      return { text: job ? `running ${job}` : "running a job", tone: "text-foreground" };
    case "minting":
      return { text: "starting", tone: "text-muted-foreground" };
    case "waiting":
      return { text: "stepped aside for memory", tone: "text-warning" };
    case "backoff":
      return { text: "waiting before it tries again", tone: "text-destructive" };
    case "stopped":
      return { text: "stopped", tone: "text-muted-foreground" };
  }
}

// A runner an older Runnerbox reports as registered, which it can't tell apart from one on a job.
export const READY_OR_RUNNING = { text: "ready or running a job", tone: "text-muted-foreground" } as const;

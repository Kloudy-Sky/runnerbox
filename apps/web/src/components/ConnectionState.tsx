import type { ConnectionState as State } from "@runnerbox/client-runtime";
import { cn } from "../lib/utils.ts";

const LABEL = { connected: "connected", connecting: "connecting", disconnected: "offline" } as const;
const DOT = { connected: "bg-success", connecting: "bg-muted-foreground", disconnected: "bg-destructive" } as const;

// Status as a dot and a plain word; the dot carries the color.
export function ConnectionState({ connection, className }: { connection: State | undefined; className?: string }) {
  const status = connection?.status ?? "connecting";
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-muted-foreground", className)}>
      <span className={cn("size-1.5 rounded-full", DOT[status])} />
      {LABEL[status]}
    </span>
  );
}

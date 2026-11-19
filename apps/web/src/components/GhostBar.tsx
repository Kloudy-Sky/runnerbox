import { cn } from "../lib/utils.ts";

// A bar in the shape of text or a block that hasn't arrived, as T3 Code's loading ghosts draw them.
// Unlike upstream, it doesn't pulse, so a page waiting on an answer repaints nothing.
export function GhostBar({ className }: { className?: string | undefined }) {
  return <span aria-hidden className={cn("block h-3 rounded bg-muted-foreground/15", className)} />;
}

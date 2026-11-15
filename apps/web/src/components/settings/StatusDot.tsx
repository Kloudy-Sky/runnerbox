import { cn } from "../../lib/utils.ts";

export const StatusDot = ({ available }: { available: boolean }) => (
  <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", available ? "bg-success" : "bg-destructive")} />
);

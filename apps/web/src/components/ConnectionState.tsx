import type { Route, ConnectionState as State } from "@runnerbox/client-runtime";
import { routePhrase } from "../lib/routes.ts";
import { cn } from "../lib/utils.ts";

const LABEL = { connected: "connected", connecting: "connecting", disconnected: "offline" } as const;
const DOT = { connected: "bg-success", connecting: "bg-muted-foreground", disconnected: "bg-destructive" } as const;

// Status as a dot and plain words; the dot carries the color. With `route`, a live connection says
// how it got there: "connected, this machine", "connected over SSH".
export function ConnectionState({ connection, route, className }: { connection: State | undefined; route?: Route | undefined; className?: string }) {
  const status = connection?.status ?? "connecting";
  const how = status === "connected" && route ? routePhrase(route) : null;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-muted-foreground", className)}>
      <span className={cn("size-1.5 rounded-full", DOT[status])} />
      {how ? `${LABEL[status]}${how === "this machine" ? ", " : " "}${how}` : LABEL[status]}
    </span>
  );
}

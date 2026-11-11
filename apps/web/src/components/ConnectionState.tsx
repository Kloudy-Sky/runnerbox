import type { ConnectionState as State } from "@runnerbox/client-runtime";

const LABEL = { connected: "connected", connecting: "connecting", disconnected: "offline" } as const;
const COLOR = { connected: "text-green", connecting: "text-dim", disconnected: "text-red" } as const;

export function ConnectionState({ connection }: { connection: State | undefined }) {
  const status = connection?.status ?? "connecting";
  return <span className={COLOR[status]}>{LABEL[status]}</span>;
}

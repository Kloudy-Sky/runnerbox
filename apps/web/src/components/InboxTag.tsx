import type { InboxItem } from "@runnerbox/contracts";

const TAGS = {
  code: ["code", "text-red"],
  infra: ["infra", "text-amber"],
  flaky: ["flaky", "text-amber"],
  unconfirmed: ["failed", "text-dim"],
  failing_slot: ["runner", "text-red"],
  no_runner: ["queue", "text-dim"],
  slow_job: ["slow", "text-dim"],
} as const;

export function InboxTag({ item }: { item: Pick<InboxItem, "kind" | "verdict"> }) {
  const [label, color] = TAGS[item.kind === "failure" ? (item.verdict ?? "unconfirmed") : item.kind];
  return <span className={color}>{label}</span>;
}

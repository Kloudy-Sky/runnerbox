import { useState } from "react";
import type { useInboxWrites } from "../../hooks/useInboxWrites.ts";
import type { useThread } from "../../hooks/useThread.ts";
import type { ItemRow } from "../../lib/inboxRows.ts";
import { snoozeWakeLabel } from "../../lib/snoozePresets.ts";
import { Button } from "../ui/button.tsx";
import { toastManager } from "../ui/toast.tsx";
import { SnoozeMenu } from "./SnoozeMenu.tsx";

const FIRST_QUESTION = "Is this right, and what should I do about it?";

// An opened item's buttons. Approve when a rule wrote the fix and this session may approve it,
// otherwise Find out why, which asks the agent in the item's thread. Then Snooze and Settle, or
// the way back out of either.
export function InboxActions({ row, writes, thread }: { row: ItemRow; writes: ReturnType<typeof useInboxWrites>; thread: ReturnType<typeof useThread> }) {
  const [pending, setPending] = useState(false);
  const act = async (write: () => Promise<unknown>) => {
    setPending(true);
    try {
      await write();
    } catch (error) {
      toastManager.add({ type: "error", title: "That didn't work", description: error instanceof Error ? error.message : "" });
    } finally {
      setPending(false);
    }
  };
  const askable = row.item.fix === undefined && thread.view.items.length === 0 && thread.permitted && thread.provider?.available === true;
  const findOutWhy = askable ? (
    <Button size="sm" disabled={pending} onClick={() => void thread.send(FIRST_QUESTION)}>
      Find out why
    </Button>
  ) : null;
  if (row.status === "handled") return <div className="flex">{findOutWhy}</div>;
  if (row.status === "settled") {
    return (
      <div className="flex">
        <Button size="sm" variant="ghost-muted" disabled={pending} onClick={() => void act(() => writes.unsettle(row))}>
          Unsettle
        </Button>
      </div>
    );
  }
  if (row.status === "snoozed") {
    const until = row.item.state?.snoozedUntil;
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost-muted" disabled={pending} onClick={() => void act(() => writes.wake(row))}>
          Wake now
        </Button>
        {until ? <span className="text-muted-foreground text-xs">Back in {snoozeWakeLabel(until, { now: new Date().toISOString() })}, or sooner if it fails again</span> : null}
      </div>
    );
  }
  const approvable = writes.canApprove(row);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        {approvable ? (
          <Button size="sm" disabled={pending} onClick={() => void act(() => writes.approve(row))}>
            Approve
          </Button>
        ) : (
          findOutWhy
        )}
        <SnoozeMenu onSnooze={(until) => void act(() => writes.snooze(row, until))} />
        <Button size="sm" variant="ghost-muted" disabled={pending} onClick={() => void act(() => writes.settle(row))}>
          Settle
        </Button>
      </div>
      {approvable ? <p className="text-muted-foreground text-xs">Applies when no job is running. You can undo it in Settings, Changes.</p> : null}
    </div>
  );
}

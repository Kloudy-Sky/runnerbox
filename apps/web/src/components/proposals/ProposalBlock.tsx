import type { ApplyWhen, Proposal } from "@runnerbox/contracts";
import { useState } from "react";
import type { useProposals } from "../../hooks/useProposals.ts";
import { fieldWords, statusWords, valueWords } from "../../lib/changeWords.ts";
import { Button } from "../ui/button.tsx";
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogPopup, DialogTitle } from "../ui/dialog.tsx";

type Actions = ReturnType<typeof useProposals>;

const WHEN: ReadonlyArray<readonly [ApplyWhen, string, string]> = [
  ["idle", "When no job is running", "up applies it at the first moment none of this install's runners is busy, within 6 hours, or drops it."],
  ["now", "Now", "up applies it at once. Busy jobs finish first; new jobs wait until up has restarted."],
];

// Every field the proposal changes, before and after, one row each. Shown in full, the same in
// the thread, the confirmation and Settings.
function Changes({ proposal }: { proposal: Proposal }) {
  return (
    <table className="border-collapse text-[13px]">
      <tbody>
        {proposal.changes.map((change) => (
          <tr key={change.path}>
            <td className="py-0.5 pr-6">{fieldWords(change.path)}</td>
            <td className="py-0.5 pr-2 text-right font-mono text-[12px] text-muted-foreground tabular-nums">{valueWords(change.path, change.from)}</td>
            <td className="py-0.5 pr-2 text-muted-foreground">to</td>
            <td className="py-0.5 font-mono text-[12px] tabular-nums">{valueWords(change.path, change.to)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// One proposed change to an install's numbers, where it stands, and the owner's choices on it.
export function ProposalBlock({ proposal, actions, offerRevert }: { proposal: Proposal; actions: Actions; offerRevert: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [when, setWhen] = useState<ApplyWhen>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      setConfirming(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  };
  const decidable = proposal.status === "open" && actions.canApprove;
  return (
    <div className="enter flex flex-col gap-1.5 text-[13px]" data-slot="proposal">
      <div className="text-muted-foreground">
        {proposal.revertOf ? "Proposed revert" : "Proposed change"} to {proposal.install}
      </div>
      <Changes proposal={proposal} />
      <p className="text-muted-foreground">
        {/* A revert's reason is the server's own; any other is the agent's, and untrusted. */}
        {proposal.revertOf ? null : <span className="text-faint">Agent's reason: </span>}
        {proposal.reason}
      </p>
      <p className={proposal.status === "not_applied" ? "text-destructive" : "text-muted-foreground"}>{statusWords(proposal)}</p>
      {proposal.runUrl ? (
        <p className="text-muted-foreground">
          To rerun the job, open its run on GitHub: <span className="select-all font-mono text-[12px]">{proposal.runUrl}</span>
        </p>
      ) : null}
      {error ? <p className="text-destructive">{error}</p> : null}
      {decidable || (offerRevert && proposal.status === "applied" && actions.canApprove) ? (
        <div className="flex gap-2 pt-0.5">
          {decidable ? (
            <>
              <Button size="sm" disabled={busy} onClick={() => setConfirming(true)}>
                Approve
              </Button>
              <Button size="sm" variant="ghost-muted" disabled={busy} onClick={() => void act(() => actions.decline(proposal.id))}>
                Decline
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost-muted" disabled={busy} onClick={() => void act(() => actions.revert(proposal.id))}>
              Revert
            </Button>
          )}
        </div>
      ) : null}
      <Dialog open={confirming} onOpenChange={(next) => !busy && setConfirming(next)}>
        <DialogPopup>
          <DialogTitle>Change {proposal.install}?</DialogTitle>
          <DialogDescription>up writes these values to its config, keeps the old file, and restarts.</DialogDescription>
          <Changes proposal={proposal} />
          <div className="flex flex-col gap-1 pt-1">
            {WHEN.map(([option, label, detail]) => (
              <button
                key={option}
                type="button"
                onClick={() => setWhen(option)}
                className={`flex flex-col rounded-[var(--control-radius)] px-2.5 py-1.5 text-left ${when === option ? "bg-accent" : "hover:bg-accent/60"}`}
              >
                <span>{label}</span>
                <span className="text-muted-foreground text-[13px]">{detail}</span>
              </button>
            ))}
          </div>
          {error ? <p className="text-destructive">{error}</p> : null}
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" size="sm" disabled={busy} />}>Cancel</DialogClose>
            <Button size="sm" disabled={busy} onClick={() => void act(() => actions.approve(proposal.id, proposal.hash, when))}>
              {busy ? "Approving" : "Approve"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
}

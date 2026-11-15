import type { UpdatePlan } from "../../lib/updateEverything.ts";
import { Button } from "../ui/button.tsx";
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "../ui/dialog.tsx";

type Props = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly target: string;
  readonly plan: UpdatePlan;
  // This app's version when it restarts last, else null.
  readonly appFrom: string | null;
  readonly onConfirm: () => void;
};

const HEAD = "pb-1 text-left font-normal text-muted-foreground text-xs";

// The confirmation for the sidebar's Update, after T3 Code's `UpdateEverythingDialog.tsx`: what
// moves, from which version, and each machine it skips with the reason. Update waits until every
// server has said whether it can take the release.
export function UpdateEverythingDialog({ open, onOpenChange, target, plan, appFrom, onConfirm }: Props) {
  const count = plan.servers.length + (appFrom === null ? 0 : 1);
  const checking = plan.checking.length > 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">{checking && count === 0 ? "Checking each machine" : `Update ${count} ${count === 1 ? "machine" : "machines"}?`}</DialogTitle>
          <DialogDescription>
            Runnerbox <span className="font-mono text-xs">{target}</span>
            {checking ? `, checking ${plan.checking.length} more` : null}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4 text-sm">
          {count > 0 || checking ? (
            <table className="w-full">
              <thead>
                <tr>
                  <th className={HEAD}>Machine</th>
                  <th className={HEAD}>Now</th>
                  <th className={HEAD} />
                </tr>
              </thead>
              <tbody>
                {plan.servers.map((server) => (
                  <tr key={server.environmentId}>
                    <td className="max-w-40 truncate py-0.5 pr-3">{server.label}</td>
                    <td className="py-0.5 pr-3 font-mono text-xs">{server.from}</td>
                    <td className="py-0.5 text-muted-foreground">server</td>
                  </tr>
                ))}
                {plan.checking.map((server) => (
                  <tr key={server.environmentId} className="text-muted-foreground">
                    <td className="max-w-40 truncate py-0.5 pr-3">{server.label}</td>
                    <td className="py-0.5 pr-3 font-mono text-xs">{server.from}</td>
                    <td className="py-0.5">checking</td>
                  </tr>
                ))}
                {appFrom !== null ? (
                  <tr>
                    <td className="py-0.5 pr-3">This app</td>
                    <td className="py-0.5 pr-3 font-mono text-xs">{appFrom}</td>
                    <td className="py-0.5 text-muted-foreground">restarts last</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          ) : null}
          {plan.skipped.length > 0 ? (
            <table className="w-full">
              <thead>
                <tr>
                  <th className={HEAD}>Skipped</th>
                  <th className={HEAD} />
                </tr>
              </thead>
              <tbody>
                {plan.skipped.map((machine) => (
                  <tr key={machine.environmentId}>
                    <td className="max-w-40 truncate py-0.5 pr-3 align-top">{machine.label}</td>
                    <td className="py-0.5 text-muted-foreground">{machine.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </DialogPanel>
        <DialogFooter variant="bare">
          <DialogClose render={<Button variant="ghost" size="sm" />}>Cancel</DialogClose>
          <Button size="sm" disabled={checking || count === 0} onClick={onConfirm}>
            Update
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

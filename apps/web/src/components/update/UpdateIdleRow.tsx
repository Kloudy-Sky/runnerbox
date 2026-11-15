import { ArrowUp } from "lucide-react";
import { useState } from "react";
import { APP_VERSION, useUpdatePlan } from "../../hooks/useUpdatePlan.ts";
import { summary } from "../../lib/updateEverything.ts";
import { updateEverything } from "../../state/updateEverything.ts";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip.tsx";
import { UpdateEverythingDialog } from "./UpdateEverythingDialog.tsx";
import { ROW } from "./row.ts";

// The Update row before a run: what it would update, on hover, and the confirmation on click.
// When only this app has an update, and nothing is skipped, it restarts into it straight away, as
// the sidebar's Restart to update did.
export function UpdateIdleRow() {
  const [open, setOpen] = useState(false);
  const { target, plan, installsApp, appReady, install } = useUpdatePlan(open);
  if (target === null || plan === null) return null;
  // A server whose version isn't known yet may well be current, so it isn't counted until it says.
  const behind = [...plan.servers, ...plan.checking.filter((server) => server.from !== null)];
  if (behind.length === 0 && !appReady && !open) return null;
  const onlyApp = behind.length === 0 && plan.skipped.length === 0;
  const confirm = () => {
    setOpen(false);
    updateEverything(target, plan.servers, installsApp);
  };
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <button type="button" className={ROW} onClick={() => (onlyApp ? void install?.() : setOpen(true))}>
              <ArrowUp className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{onlyApp ? "Restart to update" : summary(behind.length, installsApp)}</span>
            </button>
          }
        />
        <TooltipPopup side="top" align="start">
          <div className="grid grid-cols-[auto_auto] gap-x-3 text-xs">
            {behind.map((server) => (
              <span key={server.environmentId} className="contents">
                <span>{server.label}</span>
                <span className="text-muted-foreground">
                  {server.from} → {target}
                </span>
              </span>
            ))}
            {installsApp ? (
              <>
                <span>This app</span>
                <span className="text-muted-foreground">
                  {APP_VERSION} → {target}, last
                </span>
              </>
            ) : null}
          </div>
        </TooltipPopup>
      </Tooltip>
      <UpdateEverythingDialog open={open} onOpenChange={setOpen} target={target} plan={plan} appFrom={installsApp ? APP_VERSION : null} onConfirm={confirm} />
    </>
  );
}

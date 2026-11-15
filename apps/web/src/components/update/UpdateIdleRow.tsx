import { CircleArrowUp } from "lucide-react";
import { useState } from "react";
import { APP_VERSION, useUpdatePlan } from "../../hooks/useUpdatePlan.ts";
import { summary } from "../../lib/updateEverything.ts";
import { updateEverything } from "../../state/updateEverything.ts";
import { railFade } from "../railFade.ts";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "../ui/sidebar.tsx";
import { UpdateEverythingDialog } from "./UpdateEverythingDialog.tsx";

// The Update row before a run: what it would update, on hover, and the confirmation on click.
// When only this app has an update, and nothing is skipped, it restarts into it straight away, as
// the sidebar's Restart to update did. On the rail, the hover also names the action.
export function UpdateIdleRow() {
  const [open, setOpen] = useState(false);
  const { state } = useSidebar();
  const { target, plan, installsApp, appReady, install } = useUpdatePlan(open);
  if (target === null || plan === null) return null;
  // A server whose version isn't known yet may well be current, so it isn't counted until it says.
  const behind = [...plan.servers, ...plan.checking.filter((server) => server.from !== null)];
  if (behind.length === 0 && !appReady && !open) return null;
  const onlyApp = behind.length === 0 && plan.skipped.length === 0;
  const label = onlyApp ? "Restart to update" : summary(behind.length, installsApp);
  const collapsed = state === "collapsed";
  const confirm = () => {
    setOpen(false);
    updateEverything(target, plan.servers, installsApp);
  };
  return (
    <>
      <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip={{
            hidden: onlyApp && !collapsed,
            side: collapsed ? "right" : "top",
            align: collapsed ? "center" : "start",
            children: (
              <div className="grid grid-cols-[auto_auto] gap-x-3 text-xs">
                {collapsed ? <span className="col-span-2 pb-0.5 font-medium">{label}</span> : null}
                {behind.map((server) => (
                  <span key={server.environmentId} className="contents">
                    <span>{server.label}</span>
                    <span className="text-muted-foreground">
                      {server.from} → {target}
                    </span>
                  </span>
                ))}
                {installsApp && !onlyApp ? (
                  <>
                    <span>This app</span>
                    <span className="text-muted-foreground">
                      {APP_VERSION} → {target}, last
                    </span>
                  </>
                ) : null}
              </div>
            ),
          }}
          onClick={() => (onlyApp ? void install?.() : setOpen(true))}
        >
          <CircleArrowUp />
          <span className={railFade}>{label}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
      </SidebarMenu>
      <UpdateEverythingDialog open={open} onOpenChange={setOpen} target={target} plan={plan} appFrom={installsApp ? APP_VERSION : null} onConfirm={confirm} />
    </>
  );
}

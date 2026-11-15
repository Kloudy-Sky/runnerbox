import { CircleArrowUp } from "lucide-react";
import { useDesktopUpdates } from "../hooks/useDesktopUpdates.ts";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "./ui/sidebar.tsx";

// The sidebar's place for updating, above the account. It holds the desktop app's own restart
// until the button that updates every machine at once takes its place.
export function SidebarUpdateSlot() {
  const updates = useDesktopUpdates();
  if (updates?.state.status !== "ready") return null;
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton title={`runnerbox ${updates.state.pending ?? ""} is downloaded`} onClick={() => void updates.actions.install()}>
          <CircleArrowUp />
          <span>Restart to update</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

import { UpdateEverything } from "./update/UpdateEverything.tsx";

// The sidebar's place for updating, above the account: the row that updates every connected
// machine, then this app. It renders nothing when there's nothing to update.
export function SidebarUpdateSlot() {
  return <UpdateEverything />;
}

import { useUpdateEverything } from "../../state/updateEverything.ts";
import { UpdateIdleRow } from "./UpdateIdleRow.tsx";
import { UpdateRunRow } from "./UpdateRunRow.tsx";

// The sidebar's Update: one row that updates every connected machine's server, then this app.
// Renders nothing when there's nothing to update. SidebarUpdateSlot mounts it in the sidebar footer.
export function UpdateEverything() {
  const run = useUpdateEverything((state) => state.run);
  return run ? <UpdateRunRow run={run} /> : <UpdateIdleRow />;
}

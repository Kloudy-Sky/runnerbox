import { useStore } from "zustand";
import { useActiveEnvironment } from "../../hooks/useEnvironment.ts";
import { runtime } from "../../runtime.ts";
import { usePreferences } from "../../state/preferences.ts";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select.tsx";

export const ALL_MACHINES = "all";

// All machines, or one. Picking one makes it the active machine, as the sidebar's switcher does,
// so the job history and repository picker beside it follow it. With one machine it's named, as
// the repository picker names a lone repository.
export function MachinePicker({ value, onChange }: { readonly value: string; readonly onChange: (value: string) => void }) {
  const environments = useStore(runtime.store, (state) => state.environments);
  const { environment } = useActiveEnvironment();
  const setActive = usePreferences((state) => state.setActive);
  if (environments.length < 2) return <span className="truncate text-muted-foreground max-sm:hidden">{environment?.label}</span>;
  const labels = new Map([[ALL_MACHINES, "All machines"], ...environments.map((saved) => [saved.environmentId, saved.label] as const)]);
  return (
    <Select
      value={value}
      onValueChange={(picked) => {
        if (!picked) return;
        if (picked !== ALL_MACHINES) setActive(picked);
        onChange(picked);
      }}
    >
      <SelectTrigger size="sm" className="w-auto min-w-0 font-medium">
        <SelectValue>{() => labels.get(value)}</SelectValue>
      </SelectTrigger>
      <SelectPopup>
        {[...labels].map(([id, label]) => (
          <SelectItem key={id} value={id}>
            {label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

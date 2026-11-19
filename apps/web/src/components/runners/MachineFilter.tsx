import { ChevronDown } from "lucide-react";
import type { RunnerMachine } from "../../state/runnerMachines.ts";
import { Button } from "../ui/button.tsx";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu.tsx";

const ALL = "";

// All machines, or one. Picking one narrows the page to it; `picked` is its key, or null for all.
export function MachineFilter({ machines, picked, onPick }: { machines: ReadonlyArray<RunnerMachine>; picked: string | null; onPick: (machine: RunnerMachine | null) => void }) {
  const current = machines.find((machine) => machine.key === picked);
  return (
    <Menu>
      <MenuTrigger render={<Button variant="outline" size="compact" />}>
        {current?.name ?? "All machines"}
        <ChevronDown className="text-muted-foreground" />
      </MenuTrigger>
      <MenuPopup align="end" className="min-w-44">
        <MenuRadioGroup value={current?.key ?? ALL} onValueChange={(key) => onPick(machines.find((machine) => machine.key === key) ?? null)}>
          <MenuRadioItem value={ALL} closeOnClick>All machines</MenuRadioItem>
          {machines.map((machine) => (
            <MenuRadioItem key={machine.key} value={machine.key} closeOnClick>
              {machine.name}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

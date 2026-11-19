import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";
import { runnerMachinesAtom } from "../state/runnerMachines.ts";
import { runnersRangeAtom } from "../state/runners.ts";

// Every saved machine's runners over the range a page shows. The range lives in the page's URL, so
// the page hands it to the atoms, which keep the last range's answer until the new one lands.
export function useRunnerMachines(days: number) {
  const setRange = useAtomSet(runnersRangeAtom);
  // Handing the URL's range to the atoms is synchronizing with something outside React.
  useEffect(() => setRange(days), [days, setRange]);
  return useAtomValue(runnerMachinesAtom);
}

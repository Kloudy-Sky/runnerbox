import { GhostBar } from "../GhostBar.tsx";

// A machine before its first answer, in the shape it will take: a row of bays with a word and a
// time under each, beside its memory chart. The page then fills in where it stands.
export function MachineGhost() {
  return (
    <div role="status" aria-label="Loading runners" className="grid gap-x-10 gap-y-6 lg:grid-cols-2">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-x-2 gap-y-3">
        {[0, 1, 2].map((bay) => (
          <div key={bay} className="flex flex-col gap-1.5">
            <GhostBar className="h-20 rounded-none" />
            <GhostBar className="w-3/4" />
            <GhostBar className="h-2.5 w-1/2" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-3">
        <GhostBar className="w-2/3" />
        <GhostBar className="h-28 rounded-none" />
      </div>
    </div>
  );
}

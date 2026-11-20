import { GhostBar } from "../GhostBar.tsx";

// Speed and cost's answers before they arrive, each in the shape it will take, as T3 Code's Usage
// page holds its place: the page draws its sections at once and only their insides fill in.

// The figure, with its sentence beside it, or under it on a phone, where the sentence wraps.
export const SavingsGhost = () => (
  <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
    <GhostBar className="h-15 w-28" />
    <div className="flex min-w-48 max-w-xl flex-1 flex-col gap-2.5 pb-1.5 max-sm:basis-full">
      <GhostBar />
      <GhostBar className="w-3/4 sm:hidden" />
      <GhostBar className="w-1/2" />
    </div>
  </div>
);

export const FactsGhost = () => (
  <div className="grid grid-cols-2 gap-x-8 gap-y-4 min-[720px]:grid-cols-4">
    {["own", "github", "job", "wait"].map((fact) => (
      <div key={fact} className="flex flex-col gap-3 py-2.5">
        <GhostBar className="w-24" />
        <GhostBar className="h-6 w-16" />
      </div>
    ))}
  </div>
);

// A machine's row under its column names: its name, its month of days, its sentence, then the
// legend. In a narrow column, as on a phone, the names go and the row stacks, as HealthRows does.
export const HealthGhost = () => (
  <div className="@container flex flex-col gap-4">
    <div className="hidden h-8 items-end @3xl:flex">
      <GhostBar className="h-2.5 w-1/3" />
    </div>
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-col gap-3 @3xl:h-9 @3xl:flex-row @3xl:items-center @3xl:gap-6">
        <div className="flex flex-col gap-2 py-1 @3xl:py-0">
          <GhostBar className="w-28 shrink-0" />
          <GhostBar className="w-20 @3xl:hidden" />
        </div>
        <GhostBar className="h-5 @3xl:flex-1" />
        <GhostBar className="h-12 w-1/2 @3xl:hidden" />
      </div>
      <GhostBar className="my-1 w-2/3" />
      <GhostBar className="my-1 w-3/4 @3xl:hidden" />
      <GhostBar className="my-1 w-1/2 @3xl:hidden" />
    </div>
    <div className="flex flex-col gap-1">
      <GhostBar className="my-0.5 w-1/2" />
      <GhostBar className="my-0.5 w-2/3 @3xl:hidden" />
      <GhostBar className="my-0.5 w-1/3 @3xl:hidden" />
    </div>
  </div>
);

// The jobs, longest first, beside one job's steps.
export const TimeGhost = () => (
  <div className="grid gap-x-10 gap-y-6 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
    <div className="flex flex-col">
      <div className="flex h-6 items-start">
        <GhostBar className="h-2.5 w-24" />
      </div>
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="flex h-7 items-center">
          <GhostBar className="h-3.5 w-full" />
        </div>
      ))}
    </div>
    <div className="flex flex-col gap-3">
      <GhostBar className="my-1 w-2/3" />
      <StepsGhost />
      <GhostBar className="my-1 w-1/3" />
    </div>
  </div>
);

// One job's steps as a bar, over the legend that names them.
export const StepsGhost = () => (
  <div className="flex flex-col gap-2.5">
    <GhostBar className="h-7" />
    <GhostBar className="my-3 w-2/3" />
  </div>
);

// The week by hour, 24 cells by 7, beside what it says.
export const WaitGhost = () => (
  <div className="grid items-start gap-x-10 gap-y-4 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
    <div className="flex flex-col gap-2">
      <GhostBar className="aspect-[24/7] h-auto" />
      <GhostBar className="my-0.5 w-1/2" />
    </div>
    <div className="flex flex-col gap-2">
      <GhostBar className="my-1" />
      <GhostBar className="my-1 w-3/4" />
    </div>
  </div>
);

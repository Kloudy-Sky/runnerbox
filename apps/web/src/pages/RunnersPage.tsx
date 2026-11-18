import { RUNNERS_QUESTION } from "@runnerbox/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useStore } from "zustand";
import { Episodes } from "../components/runners/Episodes.tsx";
import { LastHour, lastHourNote } from "../components/runners/LastHour.tsx";
import { MachineFilter } from "../components/runners/MachineFilter.tsx";
import { MachineSection } from "../components/runners/MachineSection.tsx";
import { MoveCi } from "../components/runners/MoveCi.tsx";
import { SectionTitle } from "../components/runners/SectionTitle.tsx";
import { WaitingJobs } from "../components/runners/WaitingJobs.tsx";
import { ThreadColumn } from "../components/ThreadColumn.tsx";
import { Button } from "../components/ui/button.tsx";
import { useActiveEnvironment } from "../hooks/useEnvironment.ts";
import { useMoveCi } from "../hooks/useMoveCi.ts";
import { useRange } from "../hooks/useRange.ts";
import { type RunnerMachine, useRunnerMachines } from "../hooks/useRunnerMachines.ts";
import { useRunnerQueueEverywhere } from "../hooks/useRunnerQueueEverywhere.ts";
import { formatAge } from "../lib/format.ts";
import { parseSearch, type RootSearch } from "../lib/search.ts";
import { waitingEverywhere } from "../lib/waitingEverywhere.ts";
import { runtime } from "../runtime.ts";
import { usePreferences } from "../state/preferences.ts";

// The agent's question goes to the machine this window is pointed at, so it's offered only there.
type Ask = { readonly send: () => void } | null;

// Every connected machine's runners, live: what each is doing now, its free memory, the last hour
// runner by runner, what's waiting, and what happened, in sentences the server's rules write.
// Narrowed to one machine, the agent can explain it too. Picking a machine also points the window
// at it, as the switcher does, since that's where the agent's thread lives.
export function RunnersPage() {
  const { days } = useRange();
  const { machine: pickedKey } = parseSearch(useSearch({ strict: false }));
  const navigate = useNavigate();
  const setActive = usePreferences((state) => state.setActive);
  const { environment: active } = useActiveEnvironment();
  const machines = useRunnerMachines(days);
  // With one machine there's nothing to narrow, so it's always the one picked.
  const picked = (machines.length === 1 ? machines[0] : machines.find((machine) => machine.key === pickedKey)) ?? null;
  const pick = (machine: RunnerMachine | null) => {
    if (machine) setActive(machine.environmentId);
    void navigate({ to: ".", search: (previous: RootSearch) => ({ ...previous, machine: machine?.key }) });
  };
  const view = (ask: Ask) => <Runners machines={machines} picked={picked} onPick={pick} ask={ask} />;
  const install = picked?.install;
  if (picked && install && picked.environmentId === active?.environmentId) {
    return (
      <ThreadColumn key={picked.key} subject={{ _tag: "runners", install: install.install }} placeholder="Ask about these runners">
        {(thread) => view(thread.view.items.length === 0 && thread.permitted && thread.provider?.available ? { send: () => void thread.send(RUNNERS_QUESTION) } : null)}
      </ThreadColumn>
    );
  }
  return <div className="min-h-0 flex-1 overflow-y-auto">{view(null)}</div>;
}

function Runners({ machines, picked, onPick, ask }: { machines: ReadonlyArray<RunnerMachine>; picked: RunnerMachine | null; onPick: (machine: RunnerMachine | null) => void; ask: Ask }) {
  const { days } = useRange();
  const environments = useStore(runtime.store, (state) => state.environments);
  const queues = useRunnerQueueEverywhere();
  // From the window's own environment, whose sign-in to GitHub reads the workflows.
  const moveCi = useMoveCi();
  const shown = picked ? [picked] : machines;
  const several = shown.length > 1;
  const answered = shown.flatMap((machine) => (machine.install ? [{ ...machine, install: machine.install }] : []));
  // Ages on the page are measured from the newest answer, so it renders the same from the same data.
  const now = Math.max(0, ...answered.map((machine) => machine.now));
  // Machines, not installs: one machine can run several.
  const reporting = new Set(answered.map((machine) => machine.environmentId)).size;
  const tiles = answered.filter((machine) => !machine.install.stale).flatMap((machine) => machine.install.runners);
  const running = tiles.filter((tile) => tile.state === "running").length;
  const shownQueues = [...new Set(shown.map((machine) => machine.environmentId))].flatMap((environmentId) => {
    const queue = queues.get(environmentId);
    if (!queue || queue.status === "off") return [];
    const label = environments.find((environment) => environment.environmentId === environmentId)?.label ?? null;
    return [{ key: environmentId, machine: several ? label : null, queue }];
  });
  const waiting = waitingEverywhere(shownQueues);
  const lanes = answered.filter((machine) => machine.install.lanes.length > 0).map((machine) => ({ key: machine.key, name: machine.name, lanes: machine.install.lanes, now: machine.now }));
  const episodes = answered
    .flatMap((machine) => machine.install.episodes.map((episode) => ({ episode, machine: several ? machine.name : null, now: machine.now })))
    .toSorted((a, b) => Date.parse(b.episode.endedAt) - Date.parse(a.episode.endedAt));
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-9 px-4 pt-6 pb-8 text-[13px] sm:px-6">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-medium text-lg">Runners</h1>
          {machines.length > 1 ? <MachineFilter machines={machines} picked={picked?.key ?? null} onPick={onPick} /> : null}
        </div>
        {answered.length > 0 ? (
          <div className="flex flex-col gap-1 text-[15px] leading-relaxed">
            {answered.map((machine) => (
              <p key={machine.key}>
                {several ? <span className="text-muted-foreground">{machine.name} · </span> : null}
                {machine.install.headline}
              </p>
            ))}
          </div>
        ) : null}
        {ask ? (
          <div>
            <Button onClick={ask.send}>Ask the agent to explain</Button>
          </div>
        ) : null}
        {tiles.length > 0 ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            <Fact label="Working" value={`${running} of ${tiles.length}`} detail={reporting > 1 ? `runners on ${reporting} machines` : "runners"} />
            {shownQueues.length > 0 ? <Fact label="Waiting" value={String(waiting.length)} detail={waiting[0] ? `the longest for ${formatAge(waiting[0].job.since, now)}` : "for a runner"} /> : null}
          </dl>
        ) : null}
      </header>
      {moveCi !== null && moveCi.repos.length > 0 ? <MoveCi view={moveCi} /> : null}
      {shown.map((machine) => (
        <MachineSection key={machine.key} machine={machine} running={queues.get(machine.environmentId)?.running ?? []} onPick={several ? () => onPick(machine) : null} />
      ))}
      {lanes.length > 0 ? (
        <section>
          <SectionTitle note={lastHourNote(lanes)}>The last hour, runner by runner</SectionTitle>
          <LastHour machines={lanes} />
        </section>
      ) : null}
      {shownQueues.length > 0 ? (
        <section>
          <SectionTitle note={waiting.length === 1 ? "1 job" : `${waiting.length} jobs`}>Waiting for a runner</SectionTitle>
          <WaitingJobs queues={shownQueues} now={now} />
        </section>
      ) : null}
      {answered.length > 0 ? (
        <section>
          <SectionTitle note={`the last ${days === 1 ? "day" : `${days} days`}, newest first`}>What happened</SectionTitle>
          <Episodes episodes={episodes} />
        </section>
      ) : null}
    </div>
  );
}

function Fact({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-medium text-2xl tabular-nums leading-tight">{value}</dd>
      <dd className="text-muted-foreground text-xs">{detail}</dd>
    </div>
  );
}

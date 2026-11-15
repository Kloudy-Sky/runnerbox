import type { InstallState, MemoryPicture } from "@runnerbox/contracts";
import type { ExplainInput } from "./input.ts";
import { jobText } from "./words.ts";

// A machine reading older than this is too old to call the machine's memory now. `up` samples
// every minute.
const FRESH_MS = 3 * 60_000;
// Container reads come every 15 seconds while a job runs, so one older than this is from before.
const CONTAINERS_FRESH_MS = 60_000;

const NO_READING = `No memory reading in the last ${FRESH_MS / 60_000} minutes.`;

// Where an install's jobs run, from `up`'s own word. An older `up` doesn't say.
const runsInOf = (install: InstallState) => install.kinds.find((kind) => kind.runsIn)?.runsIn ?? null;

// The machine's memory now, with each running job's share when it was measured on its own. Which
// machine and how jobs are measured follow where jobs run: in containers in the VM, in a VM of
// their own on the host, or on the host itself.
export function memoryPicture(input: ExplainInput): MemoryPicture {
  const { install, now } = input;
  const runsIn = runsInOf(install);
  if (runsIn === "host") return { _tag: "none", why: "Jobs here run on the machine itself, and Runnerbox doesn't measure its memory yet." };
  const latest = input.samples.findLast(({ sample }) => now - Date.parse(sample.time) <= FRESH_MS)?.sample;
  const machine = runsIn === "job_vm" ? latest?.host : latest?.vm;
  if (!latest || !machine) return { _tag: "none", why: NO_READING };
  const floor = install.memoryFloor ?? null;
  const base = {
    _tag: "reading" as const,
    machine: runsIn === "job_vm" ? ("host" as const) : ("VM" as const),
    at: latest.time,
    totalMiB: machine.totalMiB,
    availableMiB: machine.availableMiB,
    floorMiB: floor === null ? null : runsIn === "job_vm" ? floor.hostMiB : floor.vmMiB,
  };
  if (runsIn === "job_vm") return { ...base, jobs: [], unmeasured: "Each job runs in a VM of its own, which isn't measured on its own." };

  // Each running job's container, `<install>-<kind>-slot<n>`, from the freshest read.
  const reads = input.containerSamples.findLast(({ sample }) => now - Date.parse(sample.time) <= CONTAINERS_FRESH_MS)?.sample.containers ?? latest.containers ?? [];
  const byName = new Map(reads.map((container) => [container.name, container.memMiB]));
  const busy = install.kinds.flatMap((kind) => kind.slots.filter((slot) => slot.phase === "busy").map((slot) => ({ kind: kind.name, slot })));
  const jobs = busy.flatMap(({ kind, slot }) => {
    const memMiB = byName.get(`${install.install}-${kind}-slot${slot.slot}`);
    return memMiB === undefined ? [] : [{ kind, slot: slot.slot, job: slot.job ? jobText(slot.job) : null, memMiB }];
  });
  const unmeasured = busy.length > jobs.length ? "Running jobs aren't measured one by one yet, so they're counted with everything else." : null;
  return { ...base, jobs: unmeasured ? [] : jobs, unmeasured };
}

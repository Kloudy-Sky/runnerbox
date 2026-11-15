import { readInstallLogs } from "./install-logs.ts";
import { type ContainerSample, ContainerSampleRecord, type Sample, SampleRecord } from "./sample-record.ts";

export type InstallSample = { install: string; sample: Sample };
export type InstallContainerSample = { install: string; sample: ContainerSample };

// Every install's samples under `dir`, oldest first, each tagged with the install that recorded it.
export async function readSamples(dir: string): Promise<InstallSample[]> {
  const entries = await readInstallLogs(dir, "samples.ndjson", SampleRecord);
  return entries
    .map(({ install, record }) => ({ install, sample: record }))
    .toSorted((a, b) => Date.parse(a.sample.time) - Date.parse(b.sample.time));
}

// Every install's container reads under `dir`, oldest first, as readSamples gives samples.
export async function readContainerSamples(dir: string): Promise<InstallContainerSample[]> {
  const entries = await readInstallLogs(dir, "containers.ndjson", ContainerSampleRecord);
  return entries
    .map(({ install, record }) => ({ install, sample: record }))
    .toSorted((a, b) => Date.parse(a.sample.time) - Date.parse(b.sample.time));
}

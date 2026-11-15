# Analytics

Everything runnerbox records stays on the host, in `~/.local/state/runnerbox/` (or under `XDG_STATE_HOME`). Nothing is sent anywhere. Files are NDJSON, owner-only, and roll over at 10 MB, keeping 4 older files.

## Files

| File | Written by | One line is |
| --- | --- | --- |
| `<owner>__<repo>.ndjson` | `report` | One job, from GitHub's API |
| `<install>/samples.ndjson` | `up`, every minute | The host, the VM and every container in the VM |
| `<install>/containers.ndjson` | `up`, every 15 seconds while the install's job containers exist | Every container in the VM, without the host or VM |
| `<install>/events.ndjson` | `up` | One finished thing `up` did |
| `<install>/state.json` | `up`, as things change and every 15 seconds | Not a log: what each slot is doing now |
| `.server/` | `runnerbox serve` | Not analytics: the server's environment ID and key, and `auth.json` with pairing codes and sessions, stored as hashes |

## Samples

`time` is when the sample was taken. `host` and `vm` each have:
- `totalMiB` and `availableMiB`: `MemTotal` and `MemAvailable` from `/proc/meminfo`.
- `swapUsedMiB`: `SwapTotal` minus `SwapFree`.
- `load1`: the one-minute load average.
- `cpuBusyPercent`: busy time across all CPUs since the previous sample. It doesn't count idle, iowait or steal time (time the hypervisor gave to something else), and counts a VM's guest time once.

`containers` lists every container in the VM, from `docker stats`. Each has a `name`, its `cpuPercent` and its `memMiB`. Another launcher's containers are included, so the two can be compared. It's absent when Docker didn't answer within 10 seconds, and empty when no containers were running.

With `jobVms`, `vm` is the builder and `containers` are its image builds. Job VMs aren't sampled yet.

`containers.ndjson` has the same `containers` with its own `time`, read every 15 seconds so a short job gets more than one point. It's read only while one of the install's job containers exists, which includes a runner waiting for a job, and it stops on the first read with none or that fails. The next runner, or a minute sample that sees one, starts it again. One `docker stats --no-stream` took about 2 seconds, which is why it isn't more often. Job VMs and host installs have none.

A field that couldn't be read is absent, never `0`. A missing `host` means `/proc` wasn't readable; a missing `vm` means SSH failed. A sampler's first sample has no `cpuBusyPercent`.

## Events

Every event has `time`, when it was written, and `startedAt` and `durationMs`. Events from a runner kind carry its `runnerType`, the kind's `name`, and their `slot` counts within that kind.
- `runner`: one runner, from registration until its container ended. `exitCode` is the container's, or `null` if SSH failed. `released` is `"memory"` or `"image"` when the slot removed it unused, because memory dropped or a new image was ready, so its time was waiting, not work. Otherwise it's `false`. A runner's time includes waiting for a job, so match it to GitHub's job record for run time. `limits` has the kind's container `memoryMiB` and `cpus` when the runner ran, since an approved change can alter them later. Host kinds and older lines have none.
- `memory_wait`: a slot waiting for `memoryFloor`, or for slots that started waiting before it, before registering.
- `image_build`: a build of a project image, with `tag` and `ok`.

## Live state

`state.json` is rewritten whole, by renaming a new file over the old, so a reader never sees half of one. `updatedAt` changes at least every 15 seconds while `up` runs, so a file older than that by much means `up` stopped without draining. Each runner kind has its `image`, the tag new containers use, and `building`, a tag being built, since `buildingSince`. `buildFailedAt` is when the last build failed, and is cleared by the next one that succeeds. `rebuildDays` comes from the config. `builtAt` and `tools` are what a probe found in the current image: when Docker says it was built, and the versions of its OS, node, gh, git, docker, python, aws and the runner, each null when the image doesn't have it. They're null until the probe has run, which happens once a tag built from a context is current, including one already built when `up` starts. A kind whose `image` is a prebuilt reference isn't probed. `runsIn` says where its jobs run, `container`, `job_vm` or `host`, and only `container` jobs are sampled. An older `up` doesn't write it. Each slot has a `phase` and `since`, when it entered it:
- `waiting`: for `memoryFloor`, or for slots that started waiting first. `detail` says which.
- `minting`: registering a runner. `registered`: a runner is online, waiting for a job or running one, which `up` can't tell apart. `busy`: GitHub refused to remove it, so it has a job.
- `backoff`: waiting before the next runner, after a failed mint or a runner that failed within a minute, or the usual 5 seconds between runners. `stopped`: drained.

## In `report`

On a host with sample files, `report` joins each job to the samples taken between its start and end, with 30 seconds of slack either side. For each group it shows the median of each job's lowest `availableMiB` on the VM and host, and the P90 of each job's highest VM `swapUsedMiB`. A job is joined only to samples from its own install, recognised by its runner name starting `<install>-`. Hosted runners and another launcher's runners get no machine figures, even one sharing the same VM. A job with no samples counts in `RAN` but not in these columns, so a group's machine figures can cover fewer jobs than it ran.

## In `summary`

`summary` reads the job log, the samples and the events, all from local files. Under **Launcher**, `Failed` counts runners whose container ended non-zero or lost SSH, not ones the slot removed on purpose, which are counted under the two `Released` columns. Under **Machines**, `VM available P10` is the level available memory was below in one sample in ten.

With `--redact`, names are replaced by the first 8 hex digits of an HMAC-SHA256 of the column and the name, keyed by `summary.key` (32 random bytes, owner-only), which `summary` creates on first use. Hashing the column with the name means an install and a label with the same name get different hashes. Numbers, durations and dates aren't changed.

## Measurement traps

- `MemAvailable` is the kernel's estimate of what a new process could use without swapping. It isn't free memory, and it can drop while swap use stays flat.
- A sample a minute misses short spikes. The highest sample during a job is a lower bound on its peak.
- `docker stats` gives CPU as a percentage of one CPU, so a container using four full CPUs shows 400. Its memory is the cgroup's usage minus inactive file cache, so it still includes some page cache.
- GitHub's timestamps and the host's clock can disagree by seconds, so joining jobs to samples needs some slack.
- After a restart, `up` starts a new sampler, so the first sample after it has no CPU figure.

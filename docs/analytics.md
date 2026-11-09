# Analytics

Everything runnerbox records stays on the host, in `~/.local/state/runnerbox/` (or under `XDG_STATE_HOME`). Nothing is sent anywhere. Files are NDJSON, owner-only, and roll over at 10 MB, keeping 4 older files.

## Files

| File | Written by | One line is |
| --- | --- | --- |
| `<owner>__<repo>.ndjson` | `report` | One job, from GitHub's API |
| `<install>/samples.ndjson` | `up`, every minute | The host, the VM and every container in the VM |
| `<install>/events.ndjson` | `up` | One finished thing `up` did |

## Samples

`time` is when the sample was taken. `host` and `vm` each have:
- `totalMiB` and `availableMiB`: `MemTotal` and `MemAvailable` from `/proc/meminfo`.
- `swapUsedMiB`: `SwapTotal` minus `SwapFree`.
- `load1`: the one-minute load average.
- `cpuBusyPercent`: busy time across all CPUs since the previous sample. It doesn't count idle, iowait or steal time (time the hypervisor gave to something else), and counts a VM's guest time once.

`containers` lists every container in the VM, from `docker stats`. Each has a `name`, its `cpuPercent` and its `memMiB`. Another launcher's containers are included, so the two can be compared. It's absent when Docker didn't answer within 10 seconds, and empty when no containers were running.

A field that couldn't be read is absent, never `0`. A missing `host` means `/proc` wasn't readable; a missing `vm` means SSH failed. A sampler's first sample has no `cpuBusyPercent`.

## Events

Every event has `time`, when it was written, and `startedAt` and `durationMs`.
- `runner`: one runner, from registration until its container ended. `exitCode` is the container's, or `null` if SSH failed. `released` is `"memory"` or `"image"` when the slot removed it unused, because memory dropped or a new image was ready, so its time was waiting, not work. Otherwise it's `false`. A runner's time includes waiting for a job, so match it to GitHub's job record for run time.
- `memory_wait`: a slot waiting for `memoryFloor` before registering.
- `image_build`: a build of a project image, with `tag` and `ok`.

## Measurement traps

- `MemAvailable` is the kernel's estimate of what a new process could use without swapping. It isn't free memory, and it can drop while swap use stays flat.
- A sample a minute misses short spikes. The highest sample during a job is a lower bound on its peak.
- `docker stats` gives CPU as a percentage of one CPU, so a container using four full CPUs shows 400. Its memory is the cgroup's usage minus inactive file cache, so it still includes some page cache.
- GitHub's timestamps and the host's clock can disagree by seconds, so joining jobs to samples needs some slack.
- After a restart, `up` starts a new sampler, so the first sample after it has no CPU figure.

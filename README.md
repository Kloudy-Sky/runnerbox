# runnerbox

Throwaway GitHub Actions runners on your own hardware, with job tracking that shows what's slow, flaky or broken.

**Status: early.** Only `runnerbox report` works today. There are no runners yet, so don't point CI at this.

## What it will do

- Run each job in a fresh container, inside a firewalled VM on a machine you own.
- Mint a single-use registration for each job on the host, so the VM holds no credential that outlives a job.
- Record every job as one line of NDJSON in a local file. No server needed. OTLP export is optional.
- Answer four questions: why was this job slow, is this test flaky, was this failure infrastructure or code, and what are we saving.

## Job history

`runnerbox report` needs Node 22.18 or newer and read access to the repository's Actions. It uses `GITHUB_TOKEN`, or your `gh` login if that isn't set.

```bash
pnpm install
pnpm runnerbox report --repo owner/name
pnpm runnerbox report --repo owner/name --since 30d
pnpm runnerbox report --repo owner/name --job test --offline
```

The first command summarizes each job per runner type: runs, failures, failures that passed on retry, jobs that never got a runner, and how long jobs took and queued. `--job` compares one job's steps across runner types, which shows where a slower runner spends its time.

Each job becomes one line in `~/.local/state/runnerbox/<owner>__<name>.ndjson`, or under `XDG_STATE_HOME` if that's set. Syncs resume where they stopped. Job and branch names can be private, so the log stays outside your checkout.

Syncing makes at least one GitHub request per run, so a busy repository can take a while. It stops with 1,000 requests left in the hourly limit, because that limit is shared with everything else using the same account. Run it again after the reset to continue.

## How a project uses it

A workflow only names a label:

```yaml
runs-on: ${{ vars.LINUX_RUNNER || 'ubuntu-24.04' }}
```

Your project never imports runnerbox code, so changing that variable moves your CI on or off it. Containers get no Docker socket, so jobs that use `services:`, `container:`, Docker actions or `docker build` must stay on another runner. The base image is minimal, so anything else a job expects from `ubuntu-24.04` goes in your image layer.

| runnerbox owns | Your project owns |
| --- | --- |
| Launcher, VM setup, firewall, service | Workflows and the variable |
| Minimal base image | An image layer on top of the base |
| Job tracking and reports | A config file: org, label, runner count, memory limits, job env |

Use tagged releases only.

## Build order

1. README and threat model.
2. `runnerbox report`: job history from GitHub's API. Done.
3. Launcher, configured instead of hardcoded.
4. Scripted VM setup. The test is a stranger following this README on a clean machine.
5. Machine stats per job, and JUnit results to find flaky tests.
6. Tagged release.

## Security

Read the [threat model](docs/threat-model.md) before you run this. Never use these runners with a public repository.

## License

[MIT](LICENSE)

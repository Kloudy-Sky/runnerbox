# runnerbox

Throwaway GitHub Actions runners on your own hardware, with job tracking that shows what's slow, flaky or broken.

**Status: early.** `runnerbox report` works today. `runnerbox up` has passed one real test, three jobs on a test repository, but VM setup isn't scripted. Don't point real CI at this yet.

## What it will do

- Run each job in a fresh container, inside a firewalled VM on a machine you own.
- Run macOS jobs on a Mac's own OS, as a separate user that's wiped after every job, for work a Linux VM can't do.
- Mint a single-use registration for each job on the host, so the VM holds no credential that outlives a job.
- Record every job as one line of NDJSON in a local file. No server needed. OTLP export is optional.
- Answer four questions: why was this job slow, is this test flaky, was this failure infrastructure or code, and what are we saving.

## Install

Download `runnerbox.js` and `runnerbox.js.sha256` from a [release](https://github.com/Kloudy-Sky/runnerbox/releases), check it with `sha256sum -c runnerbox.js.sha256`, and run it with Node 22.18 or newer. It's one file with its dependencies included, so there's nothing to install.

To run from a checkout instead, use `pnpm install` and `pnpm runnerbox`. That needs a Node that can run TypeScript directly. Some distro builds, such as Ubuntu's `nodejs` package, can't, so get Node from nodejs.org or a version manager.

## Job history

`runnerbox report` needs read access to the repository's Actions. It uses `GITHUB_TOKEN`, or your `gh` login if that isn't set.

```bash
node runnerbox.js report --repo owner/name
node runnerbox.js report --repo owner/name --since 30d
node runnerbox.js report --repo owner/name --job test --offline
```

The first command summarizes each job per runner type: runs, failures, failures that passed on retry, jobs that never got a runner, and how long jobs took and queued. `--job` compares one job's steps across runner types, which shows where a slower runner spends its time. If two workflows use the same job name, add `--workflow`. `--by runner` groups by runner name without its trailing numbers instead of by label, which tells two launchers serving one label apart. On a host where `up` runs, the report also joins each job to the samples taken while it ran, and adds the median lowest memory available on the VM and host and the P90 of VM swap in use.

`runnerbox summary --repo owner/name` prints a week's markdown from the local logs, without calling GitHub: the jobs that used the most runner time, what `up` did (runners, failures, runners removed for memory or a new image, memory waits, image builds), and how close each install's machines came to running out. `--redact` replaces every repo, workflow, job, runner, install and kind name with a hash keyed by `summary.key` in the state directory. A name hashes the same every week, so summaries can be compared, but the hashes can't be checked against guessed names without the key.

To keep history and a summary current on the host, enable the timer in [`deploy/`](deploy): `systemctl --user enable --now runnerbox-report@owner__name.timer`, with `/` written as `__`. Each hour it syncs the last 2 days and writes a redacted 7-day summary to `~/.local/state/runnerbox/owner__name.summary.md`. It reads `GITHUB_TOKEN` from `~/.config/runnerbox/report.env`, which should be owner-only and hold a fine-grained token that can read the repository's Actions.

Each job becomes one line in `~/.local/state/runnerbox/<owner>__<name>.ndjson`, or under `XDG_STATE_HOME` if that's set. Syncs resume where they stopped. Job and branch names can be private, so the log stays outside your checkout.

Syncing makes at least one GitHub request per run, so a busy repository can take a while. It stops with 1,000 requests left in the hourly limit, or 20% for tokens with a small limit, because that limit is shared with everything else using the same account. Run it again after the reset to continue.

## VM setup

Jobs run in containers inside one VM, behind a libvirt network filter. The host needs KVM, libvirt (`qemu-system-x86`, `qemu-utils`, `libvirt-daemon-system`, `virtinst`) and `xorriso`, plus `br_netfilter` loaded with `net.bridge.bridge-nf-call-iptables=1`.

```bash
ssh-keygen -t ed25519 -N '' -f ~/.config/runnerbox/vm_key
node runnerbox.js vm render --config vm.json --out ~/.local/share/runnerbox/vm
~/.local/share/runnerbox/vm/create.sh
```

Copy [`runnerbox.vm.example.json`](runnerbox.vm.example.json) to start. `render` only writes files: a cloud-init seed, the network filter and `create.sh`. Read `create.sh` before you run it. It downloads and checks the cloud image, defines the filter, reserves the VM's address in the libvirt network, boots the VM, and pins its SSH host key in `known_hosts` on first login.

- **Base image:** use Ubuntu 24.04. Its default kernel stays on 6.8 through updates.
- **Firewall:** the VM can reach the internet and the gateway's DNS. It can't reach private, CGNAT, link-local, multicast or broadcast addresses, so not the host's private addresses, your LAN, a tailnet or cloud metadata. IPv6 is dropped, and the VM can only send from its own MAC and reserved address. Only the host can SSH in. CI builds the VM on a clean machine and checks this from inside it. Public addresses of your own machines are still reachable, as the [threat model](docs/threat-model.md) explains.
- **Rebuilding:** `create.sh` checks for a VM, filter, volumes or DHCP reservation left from an earlier run before it changes anything, and stops if it finds one. Remove the VM first (`virsh destroy`, `virsh undefine`, then delete its two volumes), then the filter (`virsh nwfilter-undefine`), then the DHCP reservation (`virsh net-update <network> delete ip-dhcp-host`).

## Runners

`runnerbox up` keeps runners waiting in a VM you've already set up with Docker and your image. Each one gets a registration that works for one job, then a fresh container.

```bash
docker build -t runnerbox-base image   # in the VM
docker build -t runnerbox-base-docker image/docker   # in the VM, for kinds with "docker": true
node runnerbox.js up --config /path/to/config.json   # on the host, never inside the VM
```

Copy [`runnerbox.example.json`](runnerbox.example.json) to start. To run it as a service, use [`deploy/runnerbox@.service`](deploy/runnerbox@.service).

- `name` prefixes this install's containers and runners, so give each install on a VM its own.
- `scope` is `{ "org": "name" }` or `{ "repo": "owner/name" }`. Prefer the narrowest one that works.
- `tokenFile` must have `600` permissions. Use a fine-grained token that can only do this: "Self-hosted runners: Read and write" on the organization, or "Administration: Read and write" on one repository. The repository permission can do far more than mint runners, so an org token is safer when you have an org. There's no fallback to your `gh` login.
- `vm.knownHostsFile` must already hold the VM's host key. SSH refuses to connect otherwise.
- `memoryFloor` is the memory, in MiB, that the host and the VM must each have available before a slot registers a runner. While either is below its floor, slots wait, and a runner still waiting for a job is removed. A runner that's already running a job keeps it. Runners that registered while memory was fine can still take jobs that arrive at the same moment, so set the VM's floor to at least one job's `memoryReservation`. `0` turns a check off.
- `runners` lists the kinds of runner this install offers, such as one per toolchain or size. Every kind checks the same `memoryFloor`, so together they share the machine, while each kind's `slots` caps how many of its runners wait at once. Slots waiting for memory get it in the order they started waiting, whatever their kind, so a slot whose job just ended can't jump ahead of one that has been waiting. Each has:
  - `name`, up to 20 letters and digits, which names its containers (`<install>-<name>-slot<n>`) and runners. It can't contain `-`, so its names can't match another install's.
  - `label`, the `runs-on:` label its jobs ask for. Labels must differ between kinds.
  - `slots`, how many of its runners wait for jobs at once.
  - `image`, either a prebuilt image's reference, or `{ "name": "app-ci", "context": "/path/on/host" }`. A context is a directory holding your Dockerfile, which starts `FROM runnerbox-base`. `up` builds it in the VM, tagged by a hash of its files, before that kind's slots start. It checks every 5 minutes, and when a file has changed, it builds again, provided memory is above its floor. A runner waiting for a job is restarted on the new tag within about a minute, so the next job gets it, though a job queued in that minute still runs on the old one. A job already running finishes on the image it started with. Old tags are removed as soon as no container uses them. A failed build leaves new containers on the last good image.
  - `limits`, the container's memory, CPU and process limits.
  - `env`, environment variables set in every job's container. Test runners size their worker counts from the VM's CPUs, not the container's share, so cap them here.
  - `docker`, optional. `true` gives each job its own Docker daemon: the container runs under sysbox, and its image must start the daemon, as `runnerbox-base-docker` does. It needs sysbox in the VM. VM setup installs it on first boot, so a VM made before that needs it installed by hand: stop every container first, because installing it restarts Docker, then install the `.deb` named in `src/vm/cloud-init.ts` after checking its sha256. Without sysbox, every slot of that kind fails with `unknown or invalid runtime name: sysbox-runc`.

`up` records a sample of the host, the VM and its containers every minute, plus one line for each runner, memory wait and image build, in local files described in [docs/analytics.md](docs/analytics.md).

Stopping `up` (SIGTERM or Ctrl-C) drains it: no slot registers again, runners still waiting for a job are removed, and `up` exits once every busy job has finished. A second signal exits at once, and busy containers then finish in the VM on their own. Don't start `up` again while one is still running, because each slot starts by removing its container, which kills the job in it. The service unit gives a drain 30 minutes. Lowering `slots` can leave containers running in the VM until their job finishes, so remove those with `docker rm -f`. If the VM or SSH is down, slots log that they're waiting for memory and register nothing, unless `memoryFloor.vmMiB` is `0`. If the image is broken, a slot waits a minute between attempts, and each attempt registers a runner that shows as offline until GitHub removes it.

## Jobs on a Mac's own OS

A Linux VM can't sign a Mac app. A host install runs jobs on the Mac itself, with no VM or container around them, so it protects much less. Read [what it gives up](docs/threat-model.md#jobs-on-the-hosts-own-os) first, and only give it workflows you'd run on that Mac by hand.

```bash
node runnerbox.js host render --config mac.json --out ~/.local/share/runnerbox/mac
sudo ~/.local/share/runnerbox/mac/setup.sh
node runnerbox.js up --config mac.json
```

Copy [`runnerbox.host.example.json`](runnerbox.host.example.json) to start. It needs a Mac with Apple silicon. `render` only writes files. Read `setup.sh` and `run-job` before you run setup, because both run as root. Setup creates the job user, removes other accounts' access to your home folder, installs `run-job` and the files it reads under `/usr/local/libexec/runnerbox/<name>`, downloads the runner and checks its sha256, and adds one sudoers rule that lets you run `run-job` as root without a password. Run `render` and setup again after you change the config or update runnerbox.

A host config has `host` in place of `vm`, and its one runner has no `image`, `limits` or `docker`:

- `host.user` is an account that exists only to run jobs. It's a standard user, hidden from the login window, with a password nobody knows.
- `memoryFloor.hostMiB` works as above. On a Mac it counts free, inactive and speculative memory.
- `runners` holds one kind with one slot, because cleanup removes everything the job user has.
- `allowedWorkflows`, optional, lists the only workflows whose jobs may run here. Each entry is matched against the job's workflow ref, such as `owner/name/.github/workflows/release.yml@refs/tags/v1.2.3`, and `*` matches any run of characters. Any other job fails before its first step. For a job in a reusable workflow, the ref is the workflow that called it. Without the list, every job that asks for the label runs on your Mac.

For each job, `run-job` loads a packet filter that binds only the job user, kills that user's processes, deletes its files, unpacks a fresh runner into an empty home, and runs the job with a clean environment. It cleans up the same way when the job ends. The filter drops the job's TCP and UDP to private, CGNAT and link-local addresses, to every loopback listener that isn't the job's own, and all its IPv6.

Jobs use the tools already on the Mac, read-only: Xcode's command line tools and whatever is in `/opt/homebrew/bin` and `/usr/local/bin`. They can't install with Homebrew or use `sudo`. Each job starts with an empty home, so it downloads its dependencies again. There are no samples for a host install, so reports show its jobs without machine columns.

## How a project uses it

A workflow only names a label:

```yaml
runs-on: ${{ vars.LINUX_RUNNER || 'ubuntu-24.04' }}
```

Your project never imports runnerbox code, so changing that variable moves your CI on or off it. A Mac job works the same way: `runs-on: ${{ vars.MAC_RUNNER || 'macos-15' }}`. Containers never get the VM's Docker socket. Jobs that use `services:`, `container:`, Docker actions or `docker build` need a runner kind with `"docker": true` and an image built `FROM runnerbox-base-docker`, which gives each job its own Docker daemon under the sysbox runtime that VM setup installs. The base image is minimal, so anything else a job expects from `ubuntu-24.04` goes in your image layer.

| runnerbox owns | Your project owns |
| --- | --- |
| Launcher, VM setup, firewall, service | Workflows and the variable |
| Minimal base image | An image layer on top of the base |
| Job tracking and reports | A config file: org, label, runner count, memory limits, job env |

Use tagged releases only.

## Build order

1. README and threat model.
2. `runnerbox report`: job history from GitHub's API. Done.
3. Launcher, configured instead of hardcoded. Passed its first real test.
4. Scripted VM setup. CI builds it on a clean machine.
5. Machine stats per job, and JUnit results to find flaky tests.
6. Tagged release.

## Security

Read the [threat model](docs/threat-model.md) before you run this. Never use these runners with a public repository.

## License

[MIT](LICENSE)

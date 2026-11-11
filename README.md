# runnerbox

Throwaway GitHub Actions runners on your own hardware, with job tracking that shows what's slow, flaky or broken.

**Status: early.** `runnerbox report` works today. Jobs on a Mac's own OS have passed a first real test on one Mac. `runnerbox up` has passed one real test, three jobs on a test repository, but VM setup isn't scripted. A VM for each job has passed one real test too, four jobs on a test repository. Don't point real CI at this yet.

## What it will do

- Run each job in a fresh container, inside a firewalled VM on a machine you own. Or give each job a VM of its own.
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
- `allowPublicRepos` is `false` unless you set it, and setting it needs [`jobVms`](#a-vm-for-each-job), so a stranger's job never shares a VM with yours. While it's off, `up` checks GitHub before every registration and starts no runner for a public repository, or for an org whose default runner group allows public repositories. If GitHub doesn't answer, no runner starts either. The check uses the same token: repository metadata for a repo scope, and the runner group's settings for an org.
- `tokenFile` must have `600` permissions. Use a fine-grained token that can only do this: "Self-hosted runners: Read and write" on the organization, or "Administration: Read and write" on one repository. The repository permission can do far more than mint runners, so an org token is safer when you have an org. There's no fallback to your `gh` login.
- `vm.knownHostsFile` must already hold the VM's host key. SSH refuses to connect otherwise.
- `memoryFloor` is the memory, in MiB, that the host and the VM must each have available before a slot registers a runner. While either is below its floor, slots wait, and a runner still waiting for a job is removed. A runner that's already running a job keeps it. Runners that registered while memory was fine can still take jobs that arrive at the same moment, so set the VM's floor to at least one job's `memoryReservation`. `0` turns a check off.
- `runners` lists the kinds of runner this install offers, such as one per toolchain or size. Every kind checks the install's `memoryFloor` unless it sets its own, so together they share the machine, while each kind's `slots` caps how many of its runners wait at once. Slots waiting for memory get it in the order they started waiting, whatever their kind, so a slot whose job just ended can't jump ahead of one that has been waiting. A slot only waits behind slots whose floor is no higher than its own, so a kind with a lower floor still starts while a heavier kind waits. Each has:
  - `name`, up to 20 letters and digits, which names its containers (`<install>-<name>-slot<n>`) and runners. It can't contain `-`, so its names can't match another install's.
  - `label`, the `runs-on:` label its jobs ask for. Labels must differ between kinds.
  - `slots`, how many of its runners wait for jobs at once.
  - `image`, either a prebuilt image's reference, or `{ "name": "app-ci", "context": "/path/on/host" }`. A context is a directory holding your Dockerfile, which starts `FROM runnerbox-base`. `up` builds it in the VM, tagged by a hash of its files, before that kind's slots start. It checks every 5 minutes, and when a file has changed, it builds again, provided memory is above its floor. A runner waiting for a job is restarted on the new tag within about a minute, so the next job gets it, though a job queued in that minute still runs on the old one. A job already running finishes on the image it started with. Old tags are removed as soon as no container uses them. A failed build leaves new containers on the last good image.
  - `limits`, the container's memory, CPU and process limits.
  - `env`, environment variables set in every job's container. Test runners size their worker counts from the VM's CPUs, not the container's share, so cap them here.
  - `allowedWorkflows`, optional, lists the only workflows whose jobs may run on this kind. Each entry is matched against the job's workflow ref, such as `owner/name/.github/workflows/ci.yml@refs/heads/main`, and `*` matches any run of characters. Any other job fails before its first step, and its runner is used up. A pull request's ref ends in `refs/pull/<number>/merge`, whether it comes from a fork or your own branch, so a list of branches and tags keeps every pull request off these runners. Send those jobs to another runner in the workflow's `runs-on`, or they fail here.
  - `memoryFloor`, optional, replaces the install's floor for this kind. A kind for jobs that finish in seconds, such as path filters and secret scans, can have a low floor, small `limits` and several `slots`, so those jobs don't queue behind long ones while memory is short.
  - `docker`, optional. `true` gives each job its own Docker daemon: the container runs under sysbox, and its image must start the daemon, as `runnerbox-base-docker` does. It needs sysbox in the VM. VM setup installs it on first boot, so a VM made before that needs it installed by hand: stop every container first, because installing it restarts Docker, then install the `.deb` named in `src/vm/cloud-init.ts` after checking its sha256. Without sysbox, every slot of that kind fails with `unknown or invalid runtime name: sysbox-runc`.

`up` records a sample of the host, the VM and its containers every minute, plus one line for each runner, memory wait and image build, in local files described in [docs/analytics.md](docs/analytics.md). It also keeps `state.json` beside them, with what each slot is doing now, for the desktop app's Runners tab.

Stopping `up` (SIGTERM or Ctrl-C) drains it: no slot registers again, runners still waiting for a job are removed, and `up` exits once every busy job has finished. A second signal exits at once, and busy containers then finish in the VM on their own. Don't start `up` again while one is still running, because each slot starts by removing its container, which kills the job in it. The service unit gives a drain 30 minutes. Lowering `slots` can leave containers running in the VM until their job finishes, so remove those with `docker rm -f`. If the VM or SSH is down, slots log that they're waiting for memory and register nothing, unless `memoryFloor.vmMiB` is `0`. If the image is broken, a slot waits a minute between attempts, and each attempt registers a runner that shows as offline until GitHub removes it.

## A VM for each job

By default every job shares one VM, so a job that escapes its container can read its neighbours and wait for later jobs. Add `jobVms` and that VM stops running jobs. It becomes the builder, which only builds images, and each job runs in its own copy of it, destroyed with its disk when the job ends. Start from [`runnerbox.jobvms.example.json`](runnerbox.jobvms.example.json).

- `jobVms.builder` is the VM's libvirt name, `name` in the config `vm render` read. `pool`, `network` and `gateway` are that config's too. A VM you built another way works as a builder if its disk is a volume in `pool`.
- `jobVms.addresses` lists one free address in that network for each slot, counted across all kinds. `up` reserves them and defines one more network filter, `<install>-job`, with the same rules as the VM's. It only adds what's missing, and stops if another machine has an address.
- Every kind needs `vm`, the CPUs and memory each of its jobs' VMs gets. One install can't mix the two ways, because copying the builder shuts it down. The kind's `limits`, `image`, `env` and `docker` work as before, inside the job's VM.
- `memoryFloor.vmMiB`, the install's and any kind's, must be `0`, since no job runs in the builder. Set `hostMiB` to at least one job VM's `memoryMiB`.
- The user running `up` must be able to manage `qemu:///system`, which on most systems means the `libvirt` group. That group can do anything root can on the host.
- The pool needs room for two copies of the builder's disk, plus up to the builder's `diskGiB` for each slot, because a job can fill its own disk.

`up` copies the builder's disk the first time a slot needs it, and again when a slot needs an image the copy doesn't have. A copy shuts the builder down for about as long as the disk takes to copy, then starts it again. Jobs already running aren't touched, and copies no job uses are deleted. An image you built in the builder by hand is only picked up when `up` restarts.

A job VM has to boot before its runner starts listening, and a job that arrives in that time spends it queued. Exiting `up` with a second signal leaves busy job VMs running, and the next `up` destroys each slot's when that slot starts. Samples cover the host and the builder, not job VMs, so `report` shows no machine data for these jobs yet.

A builder made by an earlier release needs one change first, because its copies would otherwise share one identity on the network. In the builder, add `dhcp-identifier: mac` under the interface in `/etc/netplan/50-cloud-init.yaml`, next to `dhcp4: true`, and run `sudo netplan apply`.

## Jobs on a Mac's own OS

A Linux VM can't sign a Mac app. A host install runs jobs on the Mac itself, with no VM or container around them, so it protects much less. Read [what it gives up](docs/threat-model.md#jobs-on-the-hosts-own-os) first, and only give it workflows you'd run on that Mac by hand.

```bash
node runnerbox.js host render --config mac.json --out ~/.local/share/runnerbox/mac
sudo ~/.local/share/runnerbox/mac/setup.sh
node runnerbox.js up --config mac.json
```

Copy [`runnerbox.host.example.json`](runnerbox.host.example.json) to start. It needs a Mac with Apple silicon. `render` only writes files. Read `setup.sh` and `run-job` before you run setup, because both run as root. Setup creates the job user, removes other accounts' access to your home folder, installs `run-job` and the files it reads under `/usr/local/libexec/runnerbox/<name>`, downloads the runner and checks its sha256, and adds one sudoers rule that lets you run `run-job` as root without a password. Run `render` and setup again after you change the config or update runnerbox.

To run it as a service, use [`deploy/io.runnerbox.plist`](deploy/io.runnerbox.plist). It runs while you're logged in, and stopping it drains like any other `up`.

A host config has `host` in place of `vm`, and its one runner has no `image`, `limits` or `docker`:

- `host.user` is an account that exists only to run jobs. It's a standard user, hidden from the login window, with a password nobody knows.
- `memoryFloor.hostMiB` works as above. On a Mac it counts free, inactive and speculative memory.
- `runners` holds one kind with one slot, because cleanup removes everything the job user has.
- `allowedWorkflows`, optional, lists the only workflows whose jobs may run here. Each entry is matched against the job's workflow ref, such as `owner/name/.github/workflows/release.yml@refs/tags/v1.2.3`, and `*` matches any run of characters. Any other job fails before its first step. For a job in a reusable workflow, the ref is the workflow that called it. Without the list, every job that asks for the label runs on your Mac.

For each job, `run-job` loads a packet filter that binds only the job user, kills that user's processes, deletes its files, unpacks a fresh runner into an empty home, and runs the job with a clean environment. It cleans up the same way when the job ends. The filter drops the job's TCP and UDP to private, CGNAT and link-local addresses, and all its IPv6 outside loopback. On loopback it drops the job's traffic to every port another account is listening on, and looks for new ones every 5 seconds, so a job can reach its own local services but not yours.

Jobs use the tools already on the Mac, read-only: Xcode's command line tools and whatever is in `/opt/homebrew/bin` and `/usr/local/bin`. They can't install with Homebrew or use `sudo`. Each job starts with an empty home, so it downloads its dependencies again, and the first run of a tool there can take several seconds longer. There are no samples for a host install, so reports show its jobs without machine columns.

## Desktop app

A desktop app shows the same history, plus what CI needs from you, for one or more machines. Each machine runs `runnerbox serve`, which reads the logs above and answers over HTTP and WebSocket. It changes nothing.

```bash
node runnerbox.js serve    # on the machine with the logs: prints a pairing code in a terminal
node runnerbox.js pair     # a fresh code, valid once for 15 minutes
```

`serve` listens on 127.0.0.1:4517. In the app, pair by address with that code. For a server on another machine, pair over SSH instead: the app forwards that machine's port 4517 over SSH and, if you leave the code empty, runs the server's `pair --json` there to get one. It uses your `~/.ssh/config`, keys and agent, and never asks for a password or accepts an unknown host key. To keep it running, enable the user unit in [`deploy/`](deploy): `systemctl --user enable --now runnerbox-serve`. From a checkout, `pnpm runnerbox serve` runs it, and `pnpm --filter @runnerbox/web build && pnpm --filter @runnerbox/desktop build && pnpm --filter @runnerbox/desktop start` runs the app (after `pnpm --filter @runnerbox/desktop ensure:electron` once).

To install the app, build it from a checkout: `pnpm install`, `pnpm --filter @runnerbox/desktop ensure:electron` once, then `pnpm desktop:dist`. On a Mac that writes `apps/desktop/release/runnerbox-0.0.0-arm64.dmg` (Apple silicon); on Linux, `runnerbox-0.0.0.AppImage` (x64). `pnpm desktop:dist --linux` builds the AppImage from a Mac too. The app carries the web client inside it, so it runs without the checkout.

- **macOS:** open the dmg and drag runnerbox to Applications. The app isn't signed or notarized. One you built yourself opens normally. If you copied or downloaded it from elsewhere, macOS refuses the first open: try once, then go to System Settings, Privacy & Security, and choose Open Anyway beside runnerbox.
- **Linux:** the AppImage hasn't been tried on Linux yet. `chmod +x runnerbox-0.0.0.AppImage` and run it; AppImages need FUSE, which on Ubuntu is the `libfuse2` package. On Ubuntu 24.04 and later, AppArmor stops it from making the user namespaces Electron's sandbox needs, and an AppImage can't carry the setuid helper Electron falls back to, so it's expected to exit with an error about the SUID sandbox helper. Electron's documented fix keeps the sandbox: run `./runnerbox-0.0.0.AppImage --appimage-extract`, then `sudo chown root:root squashfs-root/chrome-sandbox && sudo chmod 4755 squashfs-root/chrome-sandbox`, and start `squashfs-root/runnerbox`. Don't start it with `--no-sandbox`: that turns off the renderer sandbox the [threat model](docs/threat-model.md) relies on.

 through a managed Cloudflare tunnel after one sign-in, with nothing to open on its network. It needs a relay you deploy yourself; [docs/connect-setup.md](docs/connect-setup.md) has the steps and costs. A session made through Connect only reads.

An agent you already run can read the same history and runner state over MCP. `runnerbox mcp-token` prints a token and the `claude mcp add` line that uses it. The token only reads, works only at `/mcp`, and can be revoked from the app.

The **Inbox** lists what needs you, by rules over the logs: failures the machine caused (low memory, a container that died, lost SSH), jobs that keep passing only on retry, jobs that never got a runner, slots that keep failing, and jobs slower than their own history. Failures in a job's own code go under "no action", since the check already told its author.

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

Read the [threat model](docs/threat-model.md) before you run this. `up` refuses a public repository unless you set `allowPublicRepos`, which only an install that gives [each job its own VM](#a-vm-for-each-job) can. Read the threat model's conditions for public repositories before you do.

## License

[MIT](LICENSE)

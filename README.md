# runnerbox

Throwaway GitHub Actions runners on your own hardware, with job tracking that shows what's slow, flaky or broken.

**Status: early.** `runnerbox report` works today. `runnerbox up` has passed one real test, three jobs on a test repository, but VM setup isn't scripted. Don't point real CI at this yet.

## What it will do

- Run each job in a fresh container, inside a firewalled VM on a machine you own.
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

The first command summarizes each job per runner type: runs, failures, failures that passed on retry, jobs that never got a runner, and how long jobs took and queued. `--job` compares one job's steps across runner types, which shows where a slower runner spends its time. If two workflows use the same job name, add `--workflow`.

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
node runnerbox.js up --config /path/to/config.json   # on the host, never inside the VM
```

Copy [`runnerbox.example.json`](runnerbox.example.json) to start. To run it as a service, use [`deploy/runnerbox@.service`](deploy/runnerbox@.service).

- `name` prefixes this install's containers and runners, so give each install on a VM its own.
- `image` is either a prebuilt image's reference, or `{ "name": "app-ci", "context": "/path/on/host" }`. A context is a directory holding your Dockerfile, which starts `FROM runnerbox-base`. `up` builds it in the VM, tagged by a hash of its files, before any slot starts. It checks every 5 minutes, and when a file has changed, it builds again, provided memory is above its floor. New containers use the new tag, running jobs keep theirs, and old tags are removed once nothing uses them. A failed build leaves new containers on the last good image.
- `scope` is `{ "org": "name" }` or `{ "repo": "owner/name" }`. Prefer the narrowest one that works.
- `tokenFile` must have `600` permissions. Use a fine-grained token that can only do this: "Self-hosted runners: Read and write" on the organization, or "Administration: Read and write" on one repository. The repository permission can do far more than mint runners, so an org token is safer when you have an org. There's no fallback to your `gh` login.
- `vm.knownHostsFile` must already hold the VM's host key. SSH refuses to connect otherwise.
- `memoryFloor` is the memory, in MiB, that the host and the VM must each have available before a slot registers a runner. While either is below its floor, slots wait, and a runner still waiting for a job is removed. A runner that's already running a job keeps it. Runners that registered while memory was fine can still take jobs that arrive at the same moment, so set the VM's floor to at least one job's `memoryReservation`. `0` turns a check off.
- `env` sets environment variables in every job's container. Test runners size their worker counts from the VM's CPUs, not the container's share, so cap them here.

`up` records a sample of the host, the VM and its containers every minute, plus one line for each runner, memory wait and image build, in local files described in [docs/analytics.md](docs/analytics.md).

Restarting `up` removes each slot's container, which kills any job running there. Stopping it, or lowering `slots`, can leave containers running in the VM until their job times out, so remove those with `docker rm -f`. Stopping `up` removes runners still waiting for a job, but not ones running a job. If the VM or SSH is down, slots log that they're waiting for memory and register nothing, unless `memoryFloor.vmMiB` is `0`. If the image is broken, a slot waits a minute between attempts, and each attempt registers a runner that shows as offline until GitHub removes it.

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
3. Launcher, configured instead of hardcoded. Passed its first real test.
4. Scripted VM setup. CI builds it on a clean machine.
5. Machine stats per job, and JUnit results to find flaky tests.
6. Tagged release.

## Security

Read the [threat model](docs/threat-model.md) before you run this. Never use these runners with a public repository.

## License

[MIT](LICENSE)

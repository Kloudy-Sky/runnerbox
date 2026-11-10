# Threat model

This describes the intended design. **Tested** means the control is in this repo and held in a real test run. **Tested in CI** means CI builds it on a clean machine and checks it, but it hasn't run real jobs yet. **Coded** means it's in this repo and unit tested only. **Design** means it isn't in this repo yet.

## What we assume

Anything that runs in a job may be hostile, including a compromised dependency. The machine owner and the people who can edit the runner config are trusted.

## What's protected

| Asset | Threat | Control | Status |
| --- | --- | --- | --- |
| The GitHub token that mints runners | A job steals it | It stays on the host in a `600` file, and `up` refuses a looser one. The VM only ever receives a single-use registration. | Tested |
| A job's registration | It shows up in container metadata or SSH arguments | It reaches the container on stdin, so it never appears in `docker inspect` or on the host's process list. | Tested |
| The host, LAN and tailnet | A job or VM reaches them | A libvirt network filter on the VM's interface drops traffic to private ranges, link-local and CGNAT addresses, multicast, broadcast and all IPv6. The VM may reach the host's DNS. Only the host may SSH in. | Tested in CI, except IPv6, which CI's network can't show |
| Link-local cloud metadata | A job reads instance credentials | The same filter drops 169.254.0.0/16. | Tested in CI |
| Other machines on the bridge | Root in the VM spoofs the gateway's or another guest's address | The filter only lets the VM send from its own MAC and reserved IP, in both IP and ARP. | Coded |
| Later jobs | Files left behind by an earlier job | Each job gets a fresh container, removed at the end. | Tested |
| The VM's Docker daemon | A job takes it over | Containers never get the VM's Docker socket. | Tested |
| The VM, from a job with its own Docker | A job uses its Docker daemon to escape to the VM | Runner kinds with `"docker": true` run under the sysbox runtime, never `--privileged`. Each job's daemon lives inside its own container, whose root maps to an unprivileged user on the VM, and goes with the container. Containers the job starts stay behind the VM's network filter. A kernel or sysbox bug still breaks this, as it would any container. | Tested in CI |
| Other jobs' CPU, memory and processes | One job starves the rest | Each container has CPU, memory and process limits. These limit the damage but don't stop it, because memory can be overcommitted. | Tested |
| The host and VM's memory | Overcommitted jobs push both into swap | `up` registers a runner only while the host's and VM's `MemAvailable` are above `memoryFloor`, and removes idle runners when memory drops. It can't take back a job a runner already has. | Coded |
| The token `report` syncs with | A job or VM reads it and uses it on the repository | It lives only on the host, in an owner-only `~/.config/runnerbox/report.env` read by the report timer, and never reaches the VM. It needs only read access to Actions, so it can't mint runners or change code. | Coded |
| The token that mints runners, from the server | A client or agent reads it through `runnerbox-server` | The server reads only the state directory, never a launcher config or token file, and no RPC method or MCP tool returns a credential. | Coded |
| The server's data | Someone on the network reads job history or runner state | `serve` binds 127.0.0.1 unless told otherwise, and warns when it isn't loopback. Another machine reaches it by forwarding that port over SSH. | Coded |
| Pairing | A code is guessed, replayed or read from disk | Codes are 100 random bits, work once, expire after 15 minutes, and are stored only as SHA-256 hashes. Making one takes a shell as the server's user (`pair`) or a session with `access:write`. | Coded |
| Client sessions | A token leaks from disk, a URL or the access list | Tokens are stored only as SHA-256 hashes, in an owner-only file. Only the pairing response returns one. Sockets open with a ticket that lasts 30 seconds and opens one socket, so tokens stay out of URLs. A session can be revoked. | Coded |
| What a session may read | A paired client calls more than it was granted | Every RPC method declares the scopes it needs (`history:read`, `runners:read`, `access:write`), and middleware checks them before the handler runs. A session can only delegate scopes it holds. | Coded |
| Project names in a shared summary | Whoever reads a summary learns repo, job, runner and host names | `summary --redact` replaces every name with an HMAC-SHA256 keyed by a random owner-only `summary.key` on the host, so hashes can't be checked against guessed names without it. A malformed key stops redaction. Numbers, durations and dates stay readable. | Coded |

## Jobs on the host's own OS

A host install runs jobs on a Mac itself, as a separate standard user. It has no VM and no container, so these controls replace the ones above for that install, and they are weaker. Each held on one Mac running real jobs from a test repository.

| Asset | Threat | Control | Status |
| --- | --- | --- | --- |
| The GitHub token that mints runners | A job steals it | It stays in the owner's `600` file. Setup removes other accounts' access to the owner's home folder, and the job runs as another user with a clean environment. | Tested |
| The owner's files | A job reads them | The same: a separate standard user, and an owner's home no other account can enter. Files the owner keeps world-readable elsewhere on the disk stay readable. | Tested |
| Later jobs, and their secrets | A job leaves a process, a scheduled task or a file to read them | Before and after every job, `run-job` removes the job user's launchd services and crontab, kills its processes, deletes its files in the shared temp folders, and empties its home, which holds its keychains. It refuses to start a job while a process, a keychain, a launch agent or anything outside the home's `Library` survives. It also refuses a job user that `setup.sh` didn't create, so it can't be pointed at a real account. | Tested |
| The machine | A job installs software or changes settings | The job user isn't an administrator and can't use `sudo`. `run-job` refuses a job user that is an administrator. | Tested |
| The owner's root access | The sudoers rule is used for something else | It names one root-owned script that takes no arguments and reads only root-owned files, plus the registration on stdin. | Tested |
| The LAN and a tailnet | A job connects to them | A pf anchor that matches only the job user's sockets drops its TCP and UDP to private, CGNAT, link-local, multicast and broadcast addresses, and all its IPv6 outside loopback. `run-job` loads it before every job and won't run one without it. | Tested |
| Services listening on the machine | A job connects to the owner's dev server, debugger or database on loopback | pf can't tell whose listener a loopback packet is going to, so `run-job` lists the ports other accounts are listening on and blocks the job user from them, again every 5 seconds. | Tested |
| Which jobs reach the machine | A pull request, or another workflow, names the label | With `allowedWorkflows`, a root-owned hook fails any job whose workflow ref isn't listed, before its first step. | Tested |

What a host install doesn't protect, on top of the list below:

- **No kernel boundary.** A local privilege escalation bug gives a job the whole machine, including the token and the owner's keychain. The VM kinds need a container escape and then a VM escape for that.
- **No resource limits.** A job can use every core, all the memory and the whole disk. The memory floor only holds a runner back before it registers.
- **The owner's other accounts and other users.** The filter stops the job reaching them over the network, and file permissions do the rest. Anything another account leaves world-readable or world-writable is exposed.
- **A port opened mid-job.** A service another account starts while a job runs is reachable by the job for up to 5 seconds, and a connection made in that time stays open.
- **Folders macOS keeps.** Not even root may delete the app containers and a few other folders under the job user's `Library`. `run-job` refuses to start only if a keychain, a launch agent or anything outside `Library` survives. A job that gets a sandboxed app to store data in its container could pass that data to a later job.
- **Other protocols.** pf matches a socket's owner for TCP and UDP only, so the filter doesn't stop ICMP.
- **The registration.** It's an argument of the runner, so every account on the machine can read it with `ps` while the job runs.
- **The machine's tools.** Jobs run the compilers and Homebrew tools already installed. A job can't change them, but whoever can is trusted with every job's secrets.
- **Cleanup that misses a place.** It covers the home, the temp folders and `/Users/Shared`. A folder elsewhere that the owner made writable to everyone would keep a job's files.

## What isn't protected

**Container escape.** This is the risk to think about first. Only the container is thrown away. The VM persists between jobs, concurrent jobs share its kernel and Docker daemon, and jobs have passwordless sudo inside their container. A kernel or container runtime bug would let a job read a neighbouring job's secrets and stay in the VM to read later ones. It doesn't need to break out of the VM to do this.

**VM escape.** A hypervisor bug gives a job the host, including the token that mints runners, plus everything else on that machine.

**The internet.** Jobs can reach any public address, and the VM's DNS can carry data out too. A job can send out anything it can read, including its own secrets.

**Public addresses of your own machines.** The filter only blocks private ranges. If the host or a LAN service also has a public IPv4 address, a job can reach it that way, so firewall those services or add their addresses to the filter.

**Cloud metadata outside link-local.** Some providers serve instance data from other addresses, such as Azure's 168.63.129.16 and Oracle Cloud's 192.0.0.192. The filter doesn't block those, so add them yourself if you run on a cloud machine.

**Secrets given to a job.** Everything in the job can read them, including every dependency it installs.

**The registration inside the VM.** The entrypoint passes it to the runner as an argument, so every step of the job, and root in the VM, can read it with `ps`. Passing it in an environment variable wouldn't help, because jobs run as the same user with sudo and could read it from `/proc`. It works for one job, the one already running, which limits what it's worth.

**Public repositories.** Anyone can open a pull request on one, and that can run their code on your machine. Use private repositories only, and restrict the runner group to the repositories that need it.

**The image.** Parts of the base image come from package registries at build time. A compromised package gets into every job until you rebuild.

**Tracking data.** A job can write whatever it likes to its own output, so reports can't trust anything a job says about itself unless GitHub's data confirms it. The local job log holds job and branch names and is readable by anyone with access to your account on that machine.

**The server's descriptor.** Any program that can reach the server, including a web page open on the same machine, can read its environment ID and label, and try pairing codes. The API accepts any origin because it takes bearer tokens, never cookies, so a page has no credential to borrow.

**A shell on the server's machine.** Anyone who can run commands as the server's user can mint a pairing code and read every log directly, so the server adds no boundary against them.

**Availability.** A job can use its full share of the machine for as long as its timeout allows, and heavy jobs running together can swap or be killed. `memoryFloor` keeps new runners from registering while the host or VM is short, but it can't take a job back once a runner has it.

## What we recommend

- Don't run jobs holding production or deploy credentials next to untrusted code. If you run them here anyway, you're accepting the container escape risk above for those credentials.
- Don't share the host with anything you can't afford to expose.
- Give the host a token that can only manage runners, not an admin login. A repository-scoped token needs the Administration permission, which can do much more, so prefer an org-scoped one.
- Give a host install `allowedWorkflows`, and keep it to workflows that only run from protected branches and tags. Signing keys a job is given sit on that machine for the length of the job.
- Give each install on a VM its own `name`. Installs sharing a name remove each other's containers, and installs sharing a VM still share everything in the container escape risk above.

## This repository's own CI

This repo is public, so its CI only uses GitHub-hosted runners. It must never use a self-hosted one.

The Claude review job holds the PR author's personal Claude token. It skips PRs from forks, which get no secrets anyway, can only write PR comments, and can't read `/proc` or the runner's temp files, where a prompt planted in a PR comment would look for the token.

# Threat model

This describes the intended design. **Coded** means the control is in this repo and unit tested, but hasn't yet run a real job. **Design** means it isn't in this repo yet.

## What we assume

Anything that runs in a job may be hostile, including a compromised dependency. The machine owner and the people who can edit the runner config are trusted.

## What's protected

| Asset | Threat | Control | Status |
| --- | --- | --- | --- |
| The GitHub token that mints runners | A job steals it | It stays on the host in a `600` file, and `up` refuses a looser one. The VM only ever receives a single-use registration. | Coded |
| A job's registration | It shows up in container metadata or SSH arguments | It reaches the container on stdin, so it never appears in `docker inspect` or on the host's process list. | Coded |
| The host, LAN and tailnet | A job or VM reaches them | A libvirt network filter on the VM's interface drops traffic to private ranges, link-local and CGNAT addresses, and all IPv6. The VM may reach the host's DNS. Only the host may SSH in. | Design |
| Link-local cloud metadata | A job reads instance credentials | The same filter drops 169.254.0.0/16. | Design |
| Later jobs | Files left behind by an earlier job | Each job gets a fresh container, removed at the end. | Coded |
| The VM's Docker daemon | A job takes it over | Containers get no Docker socket, so jobs that need Docker or Docker actions can't run here. | Coded |
| Other jobs' CPU, memory and processes | One job starves the rest | Each container has CPU, memory and process limits. These limit the damage but don't stop it, because memory can be overcommitted. | Coded |

## What isn't protected

**Container escape.** This is the risk to think about first. Only the container is thrown away. The VM persists between jobs, concurrent jobs share its kernel and Docker daemon, and jobs have passwordless sudo inside their container. A kernel or container runtime bug would let a job read a neighbouring job's secrets and stay in the VM to read later ones. It doesn't need to break out of the VM to do this.

**VM escape.** A hypervisor bug gives a job the host, including the token that mints runners, plus everything else on that machine.

**The internet.** Jobs can reach any public address, and the VM's DNS can carry data out too. A job can send out anything it can read, including its own secrets.

**Public addresses of your own machines.** The filter only blocks private ranges. If the host or a LAN service also has a public IPv4 address, a job can reach it that way, so firewall those services or add their addresses to the filter.

**Cloud metadata outside link-local.** Some providers serve instance data from other addresses, such as Azure's 168.63.129.16 and Oracle Cloud's 192.0.0.192. The filter doesn't block those, so add them yourself if you run on a cloud machine.

**Secrets given to a job.** Everything in the job can read them, including every dependency it installs.

**The registration inside the VM.** The entrypoint passes it to the runner as an argument, so every step of the job, and root in the VM, can read it with `ps`. It works for one job, which limits what it's worth.

**Public repositories.** Anyone can open a pull request on one, and that can run their code on your machine. Use private repositories only, and restrict the runner group to the repositories that need it.

**The image.** Parts of the base image come from package registries at build time. A compromised package gets into every job until you rebuild.

**Tracking data.** A job can write whatever it likes to its own output, so reports can't trust anything a job says about itself unless GitHub's data confirms it. The local job log holds job and branch names and is readable by anyone with access to your account on that machine.

**Availability.** A job can use its full share of the machine for as long as its timeout allows, and heavy jobs running together can swap or be killed.

## What we recommend

- Don't run jobs holding production or deploy credentials next to untrusted code. If you run them here anyway, you're accepting the container escape risk above for those credentials.
- Don't share the host with anything you can't afford to expose.
- Give the host a token that can only manage runners, not an admin login. A repository-scoped token needs the Administration permission, which can do much more, so prefer an org-scoped one.
- Give each install on a VM its own `name`. Installs sharing a name remove each other's containers, and installs sharing a VM still share everything in the container escape risk above.

## This repository's own CI

This repo is public, so its CI only uses GitHub-hosted runners. It must never use a self-hosted one.

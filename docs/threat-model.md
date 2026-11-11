# Threat model

This describes the intended design. **Tested** means the control is in this repo and held in a real test run. **Tested in CI** means CI builds it on a clean machine and checks it, but it hasn't run real jobs yet. **Tested locally** means end-to-end tests run its real code against a real server, with outside services such as Clerk and Cloudflare faked, but it hasn't run deployed. **Coded** means it's in this repo and unit tested only. **Design** means it isn't in this repo yet.

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
| The machine | A stranger's pull request on a public repository runs their code | Before minting each registration, `up` refuses a public repository, or an org whose default runner group, the one its runners join, allows public repositories. It also refuses if GitHub doesn't answer within 30 seconds or doesn't say. A refused slot starts no runner and tries again a minute later. Setting `allowPublicRepos` turns this off, and an install whose jobs share a VM can't set it. | Coded |
| Later jobs | Files left behind by an earlier job | Each job gets a fresh container, removed at the end. | Tested |
| The VM's Docker daemon | A job takes it over | Containers never get the VM's Docker socket. | Tested |
| The VM, from a job with its own Docker | A job uses its Docker daemon to escape to the VM | Runner kinds with `"docker": true` run under the sysbox runtime, never `--privileged`. Each job's daemon lives inside its own container, whose root maps to an unprivileged user on the VM, and goes with the container. Containers the job starts stay behind the VM's network filter. A kernel or sysbox bug still breaks this, as it would any container. | Tested in CI |
| Other jobs, from a job that escapes its container | It reads a neighbour's secrets, or stays to read a later job's | With `jobVms`, each job runs in a VM of its own, booted from a copy of the builder's disk and destroyed with its disk when the job ends, whatever the job did to it. Each slot starts by destroying what it left behind. | Tested |
| The disk job VMs boot from | A job changes it, so later jobs start compromised | Jobs never run in the builder. Its disk is copied while it's shut down, and a job VM writes to its own thin layer over the copy. Only your image builds run in the builder. | Tested in CI |
| Other job VMs | A job VM reaches or impersonates another | Every job VM's interface has the same filter as the builder's, pinned to that VM's own MAC and reserved address, so they can't reach each other, the builder or the host. | Tested, except the spoofing rules, which are Coded |
| Which jobs reach a VM install | A pull request, or another workflow, names the label | With `allowedWorkflows` on a kind, the job's container gets a read-only hook that fails any job whose workflow ref isn't listed, before its first step. The runner reads the ref from GitHub, not from the job. | Tested |
| Other jobs' CPU, memory and processes | One job starves the rest | Each container has CPU, memory and process limits. These limit the damage but don't stop it, because memory can be overcommitted. | Tested |
| The host and VM's memory | Overcommitted jobs push both into swap | `up` registers a runner only while the host's and VM's `MemAvailable` are above `memoryFloor`, the install's or one its kind sets lower for small jobs, and removes idle runners when memory drops. It can't take back a job a runner already has. | Coded |
| The token `report` syncs with | A job or VM reads it and uses it on the repository | It lives only on the host, in an owner-only `~/.config/runnerbox/report.env` read by the report timer, and never reaches the VM. It needs only read access to Actions, so it can't mint runners or change code. | Coded |
| The token that mints runners, from the server | A client or agent reads it through `runnerbox serve` | The server reads only the state directory, never a launcher config or token file, and no RPC method or MCP tool returns a credential. | Coded |
| The server's data | Someone on the network reads job history or runner state | `serve` binds 127.0.0.1 unless told otherwise, and warns when it isn't loopback. Another machine reaches it by forwarding that port over SSH. | Coded |
| Pairing | A code is guessed, replayed or read from disk | Codes are 100 random bits, work once, expire after 15 minutes, and are stored only as SHA-256 hashes. Making one takes a shell as the server's user (`pair`) or a session with `access:write`. `serve` prints a code at start only to a terminal, so none reaches a service's log, which other accounts may be able to read. | Coded |
| Client sessions | A token leaks from disk, a URL or the access list | Tokens are stored only as SHA-256 hashes, in an owner-only file. Only the pairing response returns one. Sockets open with a ticket that lasts 30 seconds and opens one socket, so tokens stay out of URLs. Revoking a session closes the sockets it has open on this server, and a revoked session can't delegate a pairing code. | Tested locally |
| What a session may read | A paired client calls more than it was granted | Every RPC method declares the scopes it needs (`history:read`, `runners:read`, `access:write`), and middleware checks them before the handler runs. A session can only delegate scopes it holds. | Coded |
| Agent access over MCP | An agent changes something, or its token is used as an app login | `/mcp` exposes only read-only tools, each marked read-only. Its tokens come from `mcp-token`, which takes a shell as the server's user, hold only `history:read` and `runners:read`, and work only on `/mcp`; app sessions are refused there. They show in the app's access list and can be revoked. | Coded |
| The SSH route | A saved route runs something other than ssh, or trusts a new host key | Desktop main spawns ssh directly, never through a shell, refuses hosts that would parse as options, and passes `BatchMode=yes`, so ssh neither prompts for a password nor accepts an unknown host key. The forward binds 127.0.0.1 here to 127.0.0.1 there, so the server keeps listening on loopback only. Run against a throwaway loopback sshd, not a second machine. | Coded |
| Saved server tokens in the desktop app | Another program or user reads them from disk | They're encrypted with the OS keychain through Electron's `safeStorage`, in an owner-only file in the app's own data directory, and so is the Connect sign-in. Without a keychain, including Linux's fixed-key `basic_text` fallback, the app refuses to save them and says why, and nothing is written in the clear or held in memory. Pairing checks for a keychain before it spends the code, so a refused save leaves no session on the server. A plain browser has no keychain, so there they sit in that origin's local storage. | Tested locally |
| Which server gets a credential | Another machine answers at a saved address (a reused IP, a moved forward, a hijacked tunnel) and collects the token or a Connect credential | Pairing pins the environment's Ed25519 public key, the one it links to a relay with. Before sending a token, a pairing code or a Connect credential, the client has the server sign a fresh random nonce, and checks the signature against the pinned key, so an ID or key copied from the public descriptor isn't enough. An environment saved before pinning sends its token once on trust and pins the key its server proved, if that server accepts the token; a client that sees another key, or a bad signature, stops and says to pair again. A first pairing trusts whatever answers at the address the user typed. | Tested locally |
| Saved environments | A hostile server overwrites another saved environment by naming its ID | Pairing refuses an environment ID that's already saved, before spending the code, and refuses a pairing response whose ID isn't the one the server's descriptor gave. To pair a saved environment again, forget it first. | Tested locally |
| The desktop app's machine | A server, or a page it loads, runs code through the app | The UI renders server data as text in a sandboxed renderer with context isolation and no Node. Main answers IPC only from the app's own page and decodes every argument against its schema: saved environments, SSH routes, relay URLs (HTTPS only), IDs, proof requests. An SSH route's server command is free-form by design: it's a one-line command the user types for their own machine, run by that machine's shell like anything typed into `ssh`. Main refuses navigation and new windows, and denies every permission request. | Coded |
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

**Container escape, when jobs share a VM.** This is the risk to think about first, and `jobVms` is the answer to it. Without `jobVms`, only the container is thrown away. The VM persists between jobs, concurrent jobs share its kernel and Docker daemon, and jobs have passwordless sudo inside their container. A kernel or container runtime bug would let a job read a neighbouring job's secrets and stay in the VM to read later ones. It doesn't need to break out of the VM to do this.

**VM escape.** A hypervisor bug gives a job the host, including the token that mints runners, plus everything else on that machine. A VM for each job doesn't change this. With `jobVms`, `up` itself manages libvirt, so the user it runs as can do anything root can on the host. That user already holds the token, so keep it for runnerbox alone.

**The internet.** Jobs can reach any public address, and the VM's DNS can carry data out too. A job can send out anything it can read, including its own secrets.

**Public addresses of your own machines.** The filter only blocks private ranges. If the host or a LAN service also has a public IPv4 address, a job can reach it that way, so firewall those services or add their addresses to the filter.

**Cloud metadata outside link-local.** Some providers serve instance data from other addresses, such as Azure's 168.63.129.16 and Oracle Cloud's 192.0.0.192. The filter doesn't block those, so add them yourself if you run on a cloud machine.

**Secrets given to a job.** Everything in the job can read them, including every dependency it installs.

**The registration inside the VM.** The entrypoint passes it to the runner as an argument, so every step of the job, and root in the VM, can read it with `ps`. In a job's own VM, that's only the job itself. Passing it in an environment variable wouldn't help, because jobs run as the same user with sudo and could read it from `/proc`. It works for one job, the one already running, which limits what it's worth.

**Public repositories, if you allow them.** Anyone can open a pull request on one, and that can run their code on your machine. A pull request can also change the workflow, so it can ask for your label whatever your workflow says. `up` refuses them by default, so leave `allowPublicRepos` off unless you mean to serve one, and restrict the runner group to the repositories that need it.

Only an install with `jobVms` can set `allowPublicRepos`. A VM for each job takes away what a stranger's job could do to your other jobs, and nothing else. A job you let run can still:

- use the machine for as long as its timeout allows, and fill its own disk;
- reach anything on the public internet from your address, so scanning, spam or mining is traced to you;
- reach public addresses of your own machines;
- take the host with a hypervisor bug.

So if you serve a public repository:

- Give every kind `allowedWorkflows` that name only protected branches and tags, such as `owner/name/.github/workflows/*@refs/heads/main`. No pull request's job then runs here, a stranger's or your own, and your workflow sends those to GitHub's runners. This is the setting to rely on.
- If pull requests must run here, set the repository's Actions settings to require approval for all external contributors, and read a pull request's changes, workflow files included, before you approve. Approving it runs it.
- Keep secrets out of jobs that pull requests trigger, and never use `pull_request_target` to run a pull request's code. That hands a stranger's code your secrets on any runner.
- Give each job a `timeout-minutes`.
- In an organization, a runner group serves public repositories only if you allow it. Allow it for the group these runners are in and no other, and limit that group to the repositories that need it.
- Don't share the host with anything you can't afford to expose.

An approval is one person's judgment each time, which is why `allowedWorkflows` comes first. Code that reaches a listed branch still runs, so protect those branches. There is no control yet that limits what a job may reach on the internet.

**Forks of private repositories, and what changes after a check.** The check looks at the repository or runner group when a registration is minted, not at the job. If a private repository is set to run workflows from fork pull requests, those jobs still run here. A repository made public, or a runner group opened to public repositories, after a registration is minted can still send that registration its one job.

**The image.** Parts of the base image come from package registries at build time. A compromised package gets into every job until you rebuild.

**Tracking data.** A job can write whatever it likes to its own output, so reports can't trust anything a job says about itself unless GitHub's data confirms it. The local job log holds job and branch names and is readable by anyone with access to your account on that machine.

**The server's descriptor.** Any program that can reach the server, including a web page open on the same machine, can read its environment ID, label and public key, and try pairing codes. The API accepts any origin because it takes bearer tokens, never cookies, so a page has no credential to borrow.

**A shell on the server's machine.** Anyone who can run commands as the server's user can mint a pairing code and read every log directly, so the server adds no boundary against them.

**Availability.** A job can use its full share of the machine for as long as its timeout allows, and heavy jobs running together can swap or be killed. `memoryFloor` keeps new runners from registering while the host or VM is short, but it can't take a job back once a runner has it. A job VM's disk can grow to the builder's full size, so a pool without that much room for every slot can be filled by one job, which pauses the others.

## What we recommend

- Don't run jobs holding production or deploy credentials next to untrusted code. If you run them here anyway, you're accepting the container escape risk above for those credentials.
- Don't share the host with anything you can't afford to expose.
- Give the host a token that can only manage runners, not an admin login. A repository-scoped token needs the Administration permission, which can do much more, so prefer an org-scoped one.
- Give a host install `allowedWorkflows`, and keep it to workflows that only run from protected branches and tags. Signing keys a job is given sit on that machine for the length of the job.
- Use `jobVms` for anything you wouldn't run next to a stranger's code.
- Give each install on a VM its own `name`. Installs sharing a name remove each other's containers, and installs sharing a VM still share everything in the container escape risk above.

## Runnerbox Connect

Connect gives an environment a public hostname through a Cloudflare tunnel, on a machine that may also hold the token that mints runners. Everything served stays read-only, and the server never reads the launcher config or token file. **Tested locally** below means the control held in end-to-end tests against a real server and the relay's real code, with Clerk and Cloudflare faked; nothing here has run deployed.

| Asset | Threat | Control | Status |
| --- | --- | --- | --- |
| Environment sessions | The relay, or anyone holding its database, uses them | The relay never receives a session. It asks the environment for a one-time credential, and the client redeems that directly with the environment. The relay proxies no app traffic. | Tested locally |
| Which environments a user reaches | Someone signed in reaches an environment they didn't link | Every relay call needs a Clerk token, and connect and status need that user's own link. Links and tunnels belong to a user and environment pair, so claiming another machine's (public) environment ID only makes a separate, useless link. | Tested locally, with Clerk faked |
| Whose sign-in the relay accepts | A token Clerk issued to another app on the same Clerk instance acts as a relay user | The relay accepts only Clerk-signed JWTs whose `client_id` (or `azp`) is its own CLI or desktop OAuth client. Opaque tokens are refused, since a public client can't ask Clerk which client one belongs to. | Tested locally, against a stand-in JWKS |
| Linking | A link is forged, replayed, or points the tunnel elsewhere | The link proof is signed by the environment's own Ed25519 key, names a relay challenge issued to the signed-in user, lives at most 5 minutes, and its ID and the challenge's are each used once, kept until their own expiry. The origin must be a loopback host and port. | Tested locally |
| An existing link | Someone holding the user's sign-in links a key of their own, re-points the tunnel at another loopback port and takes over the mint-signing key | A link stays pinned to the key it was made with: a link under another key is refused, and the store never overwrites the key. The link row is claimed in one statement before the allocation is touched, so of two links racing under different keys only one gets a tunnel or a token. Only an unlink signed by the pinned key frees it. A machine that loses its key needs its link deleted from the relay's database by hand. | Tested locally |
| The environment's network | A tunnel exposes another service on it | The relay's ingress routes only the allocated hostname, only to the loopback origin from the link proof; anything else gets 404. | Coded; ingress shape unit tested, not against Cloudflare |
| Mint requests to an environment | Someone other than the relay gets a credential minted, or replays a real request | The environment accepts only requests signed by the relay it linked to, for itself and its linked user, at most 5 minutes old, with the client key's thumbprint in `cnf.jkt`, and exactly the `environment:connect` scope. The request's ID and nonce are each used once. | Tested locally |
| Mint answers to the relay | Another process behind the tunnel hands the client its own credential | The environment signs its answer with its key, bound to the relay's nonce, the client key and the credential. The relay checks all of them against the key pinned at link time. | Tested locally |
| Relay egress | A health or mint request is bounced to another host | The relay calls only the address of its own allocation and refuses any redirect. | Tested locally |
| A captured Connect credential | Someone else redeems it | It's bound to the client's key: redeeming needs a DPoP proof from that key. It works once, within 2 minutes, and a wrong key leaves it unspent. | Tested locally |
| A captured Connect session token | Someone else uses it | The session stays bound to the same key, and every WebSocket ticket needs a fresh DPoP proof whose ID is used once; the replay record outlasts the last moment a proof is accepted. Proofs are checked by method and path, not host, because behind the tunnel the server can't see the host the client used. The session expires after an hour and is then pruned, so failed reconnects can't pile up sessions. | Tested locally |
| What reaches the server through the tunnel | Someone on the internet redeems a CLI pairing code, uses an app session or an MCP token, or opens a socket with a loopback ticket | `cloudflared` points only at a second loopback listener, whose port the relay pins at link time. It serves the descriptor, the relay's mint and health requests, pairing that redeems only key-bound codes (a CLI code stays unspent), tickets only for key-bound sessions, and sockets only with tickets it issued itself. It doesn't serve MCP. Nothing depends on a header, so a local process reaching that port gets less, not more. The relay's endpoints aren't served on the loopback listener. | Tested locally |
| What a Connect session can do | It changes something, or hands out more access | A key-bound credential only ever buys `history:read` and `runners:read`, whatever was asked, so it can't reach access management or mint pairing codes. | Tested locally |
| The connector token | It shows up where other users can read it | It's stored owner-only in `.server/connect.json` and passed to `cloudflared` in its environment, never on its command line. | Tested locally, with a stand-in `cloudflared` |
| Tunnel teardown | A delayed cleanup deletes a tunnel a newer link just set up | Teardown first claims the allocation at the generation it read, and every change bumps it. Unlink revokes the link before tearing down, so a failed teardown leaves nothing usable. | Tested locally |
| Idle-tunnel reclaim | A sweep deletes a tunnel a machine is using, or one the relay doesn't own | A sweep deletes only tunnels Cloudflare reports down for 5 minutes (or never connected for an hour), owned by an allocation whose host registered recovery. It looks at the tunnel once more, then claims the allocation at the generation it read; a host that registers in between bumps it and keeps its tunnel. Tunnels with no allocation are never deleted. Off unless configured. | Tested locally, with Cloudflare faked |
| Recovery and replacement requests | Someone re-routes a tunnel or gets a new connector token | Both are signed by the environment's pinned key for its linked user, live at most 5 minutes, are used once, and name only a loopback origin. A replacement is refused while the allocation still has a tunnel, and keeps its hostname and DNS record. | Tested locally |
| Leaving Connect | A machine can't leave without its owner signing in again | Unlink is signed by the environment's key, so it works from a headless machine. | Tested locally |
| Clerk tokens and proof keys on the desktop | Another program reads them | Main holds the Clerk tokens, encrypted with the OS keychain, and makes every relay call. It also holds the DPoP keys, which can't be exported, and signs proofs for the renderer, which serves from a scheme that isn't a secure context and has no WebCrypto. | Coded; run in the packaged app against a local relay |

### What Connect doesn't protect

**A public hostname.** Anyone can reach the tunnel listener: its descriptor, Connect pairing, the relay's endpoints and the socket. All need a key-bound credential or a relay signature, but a bug in that code is now reachable from the internet, not just from this machine. There is no rate limit at the relay or the server.

**The relay's signing key.** Whoever holds it can have any linked environment mint read-only sessions, for the user it's linked to. Treat it like the runner token.

**Cloudflare and Clerk.** TLS ends at Cloudflare's edge, so Cloudflare can see job history in transit. Whoever takes over the Clerk account can read every environment it linked.

**A rogue relay.** Clients and the CLI learn the Clerk host and client IDs from the relay's own `/v1/config`. A relay you didn't deploy can return the real relay's values and collect a genuine Clerk token when someone signs in through it, then use it at the real relay. Closing this needs tokens bound to the relay as their audience. Only point clients at a relay URL you deployed.

**Who can sign up.** With no rate limits, anyone who can create an account on the Clerk instance can link environments, and each link creates a tunnel and a DNS record in the operator's Cloudflare account. Restrict sign-ups until limits exist; see [connect-setup.md](connect-setup.md).

**Idle tunnels, while reclaim is off.** By default the relay keeps tunnels whose connector has stopped. See [connect-setup.md](connect-setup.md) for turning reclaim on and what it costs.

**A connector that comes back without telling the relay.** `cloudflared` reconnects to Cloudflare directly. If it does so in the moment between a sweep's last look and its delete, that tunnel is deleted, and the host gets a replacement the next time it checks, within about two minutes of the connector failing.

## This repository's own CI

This repo is public, so its CI only uses GitHub-hosted runners. It must never use a self-hosted one.

The Claude review job holds the PR author's personal Claude token. It skips PRs from forks, which get no secrets anyway, can only write PR comments, and can't read `/proc` or the runner's temp files, where a prompt planted in a PR comment would look for the token.

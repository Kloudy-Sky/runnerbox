# runnerbox

Throwaway GitHub Actions runners on your own hardware, plus job history. [README.md](README.md) holds the boundary between runnerbox and the projects that use it. [docs/threat-model.md](docs/threat-model.md) holds every security control and its status.

## Principles

- **Generic.** This repo is public and serves any project. Real names stay out: no org, repo, job, label, host name or IP of a real user. Examples use `owner/name`, `example` and libvirt's defaults. `pnpm leak-check` catches known names only.
- **The host holds the credential.** The token that mints runners stays on the host in a `600` file. The VM and containers only ever get a single-use registration, sent on stdin. No RPC method or MCP tool returns it or any other credential.
- **Threat model in sync.** A change that adds, removes or weakens a control updates its row in the threat model, with the status it really has: Design, Coded, Tested locally, Tested in CI or Tested.
- **Labels are the interface.** Projects name a `runs-on:` label and never import runnerbox code. They install tagged releases, which ship `runnerbox.js` and its sha256.
- **This repo's CI** runs on GitHub-hosted runners only, with actions pinned by SHA and the fewest `permissions` that work.

## Layout

A pnpm workspace. The root package is the core and the CLI, and new code goes beside it, not in it.

- `src/`: the core (`up`, `report`, `summary`, VM setup) and the CLI that releases ship as `runnerbox.js`. Changes here stay small, since other branches work in it.
- `packages/contracts`: what crosses the wire between server and clients, in Effect Schema: the RPC group, each method's scopes, and the data it carries.
- `packages/client-runtime`: what every client shares: saved environments, pairing, and the RPC connection.
- `apps/server`: the server behind `runnerbox serve` and its sibling commands, bundled into `runnerbox.js`. It serves one machine's state directory over WebSocket RPC and MCP. Its services wrap the core's functions and never reimplement them.
- `apps/web`: the React UI. `apps/desktop`: the Electron shell around it, which adds SSH and Connect routes.
- `packages/connect`: what Runnerbox Connect's relay, server and clients share: signed proofs, DPoP, OAuth sign-in and the relay client.
- `infra/relay`: the Connect relay, a Cloudflare Worker. Never deployed from this repo; [docs/connect-setup.md](docs/connect-setup.md) has the manual steps.

An **environment** is one server and the machine it owns. Clients reach it over an ordered list of routes (loopback, SSH, Connect) and always speak the same RPC.

## Code

- TypeScript run by Node 22.18+. `pnpm typecheck`, `pnpm test` and `pnpm build` must pass; the first two cover the whole workspace.
- **arktype** in `src/`, at every boundary that reads outside input. The core stays promise-based.
- **Effect** in `apps/*` and `packages/*`, with Effect Schema for everything on the wire and every file the server owns. Server features are `Context.Service`s; an RPC handler or MCP tool decodes, calls one service method and maps its error, nothing else. Follow T3 Code's [Effect service conventions](https://github.com/pingdotgg/t3code/blob/main/docs/internals/effect-services.md).
- Types come from inference. Write `any` nowhere, and no functions that only cast.
- One concern per file. Comments say why, in a line or two, and change when the code does.
- Tests check behaviour someone relies on. A test that only restates wiring, or guards a deleted feature, is a cost.
- Shell that runs on a host (generated or shipped) uses `set -euo pipefail`, quotes every value, and checks state before changing it.

## Pull requests

One concern per PR. A conventional-commit title in plain language. The body opens with the problem, then the fix, then what was verified, and ends with the model and harness that made it.

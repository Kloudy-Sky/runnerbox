# runnerbox

Throwaway GitHub Actions runners on your own hardware, plus job history. [README.md](README.md) holds the boundary between runnerbox and the projects that use it. [docs/threat-model.md](docs/threat-model.md) holds every security control and its status.

## Principles

- **Generic.** This repo is public and serves any project. Real names stay out: no org, repo, job, label, host name or IP of a real user. Examples use `owner/name`, `example` and libvirt's defaults. `pnpm leak-check` catches known names only.
- **The host holds the credential.** The token that mints runners stays on the host in a `600` file. The VM and containers only ever get a single-use registration, sent on stdin.
- **Threat model in sync.** A change that adds, removes or weakens a control updates its row in the threat model, with the status it really has: Design, Coded, Tested in CI or Tested.
- **Labels are the interface.** Projects name a `runs-on:` label and never import runnerbox code. They install tagged releases, which ship `runnerbox.js` and its sha256.
- **This repo's CI** runs on GitHub-hosted runners only, with actions pinned by SHA and the fewest `permissions` that work.

## Code

- TypeScript run by Node 22.18+, with arktype at every boundary that reads outside input. `pnpm typecheck`, `pnpm test` and `pnpm build` must pass.
- Types come from inference. Write `any` nowhere, and no functions that only cast.
- One concern per file. Comments say why, in a line or two, and change when the code does.
- Tests check behaviour someone relies on. A test that only restates wiring, or guards a deleted feature, is a cost.
- Shell that runs on a host (generated or shipped) uses `set -euo pipefail`, quotes every value, and checks state before changing it.

## Pull requests

One concern per PR. A conventional-commit title in plain language. The body opens with the problem, then the fix, then what was verified, and ends with the model and harness that made it.

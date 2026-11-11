# Runnerbox Connect setup

Connect lets the desktop app reach a runnerbox environment on another machine through a managed Cloudflare tunnel, after one sign-in, with nothing to open on that machine's network. It has three parts:

- **The relay** (`infra/relay`), a Cloudflare Worker you deploy once. It checks who you are with Clerk, keeps which environments you linked in D1, creates one tunnel and hostname per linked environment, and asks an environment for a one-time credential when your app connects. It never holds a session to an environment and never carries app traffic.
- **The server** (`runnerbox serve`, linked with `runnerbox link`) on each machine, which links it and runs `cloudflared`.
- **The desktop app**, which signs in and connects over the tunnel.

Nothing in this repo deploys anything. These are the steps to do by hand. Every value below that looks like `example.com` is a placeholder for your own.

## What you need

- A domain whose DNS is on Cloudflare (a zone), and its zone ID and account ID from the dashboard.
- A Clerk application.
- `wrangler` and `openssl` on the machine you deploy from.

## 1. Choose hostnames

- The relay: for example `relay.example.com`.
- Tunnels: each linked environment gets `rbx-<16 hex>.<base domain>`. Use the zone itself as the base domain (`example.com`), so hostnames are one level deep and Cloudflare's free Universal SSL covers them. A base like `connect.example.com` puts them two levels deep, which needs Advanced Certificate Manager.

## 2. Cloudflare API token

Create a token (My Profile, API Tokens) with only:

- Account, Cloudflare Tunnel, Edit, for your account.
- Zone, DNS, Edit, for your zone.

It goes only into the relay's secrets (step 5).

## 3. D1 database

```bash
cd infra/relay
cp wrangler.example.toml wrangler.toml     # gitignored; fill in your values
wrangler d1 create runnerbox-relay         # copy its database_id into wrangler.toml
wrangler d1 migrations apply runnerbox-relay --remote
```

## 4. Clerk

1. In your Clerk application, note the Frontend API host (such as `clerk.example.com`). It's `CLERK_FRONTEND_API`.
2. Create two OAuth applications, both **public** clients using PKCE, with no client secret:
   - **CLI**: redirect URI `http://127.0.0.1/callback`. Turn on the **device authorization grant**, which `link --device` uses on machines you reach over SSH. Its client ID is `CLERK_CLI_CLIENT_ID`.
   - **Desktop**: redirect URI `http://127.0.0.1/callback`. Its client ID is `CLERK_DESKTOP_CLIENT_ID`.
   - Scopes: `openid profile email offline_access`.
3. Both sign-ins listen on a random loopback port. Check that Clerk accepts any port on the loopback redirect, as RFC 8252 asks; if it insists on an exact port, the sign-in fails at Clerk's redirect.

## 5. Relay keys and secrets

The relay signs every request it sends an environment with an Ed25519 key. Keep the private half as secret as the runner token: with it, anyone can have a linked environment mint read-only sessions.

```bash
openssl genpkey -algorithm ed25519 -out relay-signing.pem
openssl pkey -in relay-signing.pem -pubout -out relay-signing.pub.pem
wrangler secret put RELAY_SIGNING_PRIVATE_KEY < relay-signing.pem
wrangler secret put RELAY_SIGNING_PUBLIC_KEY < relay-signing.pub.pem
wrangler secret put CLOUDFLARE_API_TOKEN      # paste the token from step 2
rm relay-signing.pem                          # or keep it offline; the Worker has it
```

| Value | Where | Secret |
| --- | --- | --- |
| `RELAY_ISSUER` | `wrangler.toml` `[vars]`: the relay's own URL, `https://relay.example.com` | No |
| `CLERK_FRONTEND_API`, `CLERK_CLI_CLIENT_ID`, `CLERK_DESKTOP_CLIENT_ID` | `[vars]` | No; clients get them from `/v1/config` |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID`, `TUNNEL_BASE_DOMAIN` | `[vars]` | No |
| `RELAY_SIGNING_PRIVATE_KEY` | `wrangler secret put` | Yes |
| `RELAY_SIGNING_PUBLIC_KEY` | `wrangler secret put` (or `[vars]`) | No, but kept with its pair |
| `CLOUDFLARE_API_TOKEN` | `wrangler secret put` | Yes |

## 6. Deploy

```bash
wrangler deploy
curl https://relay.example.com/v1/config     # should print your Clerk values
```

## 7. Link a machine

On each machine running `runnerbox serve`:

1. Install `cloudflared` 2026.10.4 (the tested release; 2025.6.1 is the oldest accepted) from Cloudflare's releases, on `PATH` or at `RUNNERBOX_CLOUDFLARED_PATH`. runnerbox doesn't download it for you.
2. `node runnerbox.js link --relay https://relay.example.com` opens a browser to sign in. Over SSH, add `--device` and approve the code from any browser.
3. Restart `serve`. It opens a second loopback listener for the tunnel alone (by default on its own port plus one; `link --tunnel-port` chooses another), and starts `cloudflared`, pointed only at that listener. Through the tunnel, only Connect works: CLI pairing codes, app sessions and MCP tokens are refused there, and keep working on loopback and over SSH.

`node runnerbox.js link-status` shows the link, and `node runnerbox.js unlink` removes it and its tunnel. Unlinking needs no sign-in.

## 8. Connect from the desktop app

On the Connect page, under Runnerbox Connect, enter the relay URL and sign in. Linked environments are listed; Add saves one. A session made through Connect reads history and runner state only, and can't create pairing codes. To manage access, pair over loopback or SSH.

## What it costs

Per linked environment the relay makes one Cloudflare Tunnel, one proxied DNS record and a few D1 rows; each app connection is a few Worker requests and D1 queries. Check current prices before you rely on these:

- **Cloudflare Tunnel**: no per-tunnel charge on Cloudflare's free plan as this was written. T3 Code's notes say tunnels are billed whether or not a connector is attached, so confirm on your plan.
- **DNS records**: free.
- **Workers**: the free plan has a daily request allowance far above what a few environments use; the paid plan has a monthly base fee.
- **D1**: the free plan's limits are far above this use.
- **Clerk**: free up to its monthly active user allowance.
- **Advanced Certificate Manager**: a monthly fee, only if your tunnel hostnames are more than one level deep (step 1).

## Reclaiming idle tunnels

A machine that sleeps or shuts down leaves its tunnel behind. If your plan bills tunnels whether or not a connector is attached, that's a charge for nothing. The relay can reclaim them, every five minutes, from the cron trigger in `wrangler.example.toml`. `RELAY_TUNNEL_CLEANUP_MODE` sets what a sweep does:

- `off`, the default: nothing.
- `dry-run`: counts what it would delete and logs the counts, deleting nothing. Run it for a while first and read the Worker's logs (`wrangler tail`).
- `enabled`: deletes them.

The mode is read when the Worker is deployed, so change it in `wrangler.toml` and run `wrangler deploy` again.

A sweep deletes a tunnel only when Cloudflare has reported it down for five minutes, or never connected and at least an hour old, and only when its machine registered that it can replace it, which `serve` does on every start. It deletes the tunnel alone: the hostname, its DNS record and the link stay, so when the machine comes back, `serve` asks for a new tunnel under the same hostname, and your apps reconnect at the same address within a minute or two. A tunnel the relay has no record of is never deleted; clear those in the dashboard (Zero Trust, Networks, Tunnels, names starting `rbx-`). Each sweep makes at most 10 list requests and 100 deletions, stops early on a Cloudflare rate limit, and stops after 90 seconds.

What it saves is one tunnel's charge for every machine that's off, for as long as it's off. On a plan where tunnels are free, it saves nothing but clutter, and you can leave it `off`.

## Verify after deploying

- With reclaim at `dry-run`, a machine that's been off for five minutes shows up in the logged counts under `wouldDelete`; at `enabled`, its tunnel goes and comes back when `serve` restarts.

The local tests fake Clerk and Cloudflare, so these only show once deployed:

- `runnerbox link` signs in through Clerk, and `--device` shows a code.
- The tunnel comes up: `runnerbox link-status`, then `curl https://rbx-….example.com/.well-known/runnerbox/environment`.
- The desktop app signs in, lists the environment, and connects.
- Clerk's OAuth access tokens verify at the relay (as JWTs, or through `/oauth/userinfo`).

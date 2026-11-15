# Releases

Every release is a GitHub release in this repository, tagged `v<version>`, built by [`.github/workflows/release.yml`](../.github/workflows/release.yml). Each one carries `runnerbox.js` and `runnerbox.js.sha256`. Nightly and stable releases also carry the desktop app and the update feed the app reads.

| | How it starts | Version | Desktop app |
| --- | --- | --- | --- |
| Nightly | By hand: Actions, release, Run workflow, from `main`, channel `nightly`. Or every day at 06:17 UTC once `NIGHTLY_ENABLED` is set. Either way only when `main` changed since the last nightly, unless `force` is ticked. | `X.Y.Z-nightly.YYYYMMDD.<run>`, a prerelease | yes, `nightly-*.yml` feed |
| Stable | By hand: Run workflow from `main`, channel `stable` | `X.Y.Z`, marked latest | yes, `latest-*.yml` feed |
| Tag | Push a `v*` tag yourself | the tag | no: `runnerbox.js` only, as before |

## Turning on the schedule

The schedule releases nothing until the repository variable `NIGHTLY_ENABLED` is `true` (Settings, Secrets and variables, Actions, Variables). Until then each scheduled run stops in its first job and its summary says why. Run the first nightly by hand, check it, then set the variable. Remove it, or set it to anything else, to stop scheduled nightlies again; nightlies by hand keep working.

## Versions

A nightly's `X.Y.Z` is the stable it previews: one patch past the newest stable, or the version an earlier prerelease tag such as `v0.2.0-rc.3` was heading for, whichever is higher. A stable release promotes a nightly: it builds that nightly's commit again under the plain `X.Y.Z`. By default it promotes the latest nightly; the `nightly` input picks another. Only a nightly this workflow published, from a commit on `main`, counts: a tag someone pushed that merely looks like one is ignored. It refuses a version that's already released or isn't newer than the latest stable.

In semver, which the updater compares with, each nightly sorts above the stable before it and below the stable it previews. Later nightlies sort above earlier ones, by date and then by run number. So someone on nightly moves to the next stable when it ships, and the next nightly passes that stable. The workflow stamps the version into every `package.json` in its checkout, so `runnerbox.js`, `runnerbox serve` and the app all report it. It also builds the repository's name into `runnerbox.js` (`RUNNERBOX_UPDATE_REPO`, as the app's feed takes it), which `runnerbox.js --version` prints. A build from a checkout has none. Nothing is committed back.

`scripts/release-plan.ts` makes these decisions and `scripts/release-version.test.ts` tests them.

## Hosts that install by tag

Hosts download `runnerbox.js` from a release by its tag, and every release still carries it. A running `serve` downloads the same two files when it updates itself, so a release must carry both under those names. Pushing a `v*` tag yourself still releases `runnerbox.js` alone, exactly as before; a tag with a hyphen, like `v0.2.0-rc.4`, becomes a prerelease. Tags the workflow creates for nightly and stable releases never start it again. Nightlies are prereleases, so GitHub's "latest release" is always the newest stable.

## The desktop app

Each nightly and stable release builds:

- macOS: a dmg and a zip each for Apple silicon (`arm64`) and Intel (`x64`). The updater installs from the zip. Both architectures are in one `latest-mac.yml` or `nightly-mac.yml`.
- Linux: an x64 AppImage and `latest-linux.yml` or `nightly-linux.yml`.

A release is created as a draft with every file attached, then published, so a feed never names a file that isn't there yet.

### Signing

The macOS job signs with a Developer ID, uses the hardened runtime with only the entitlements V8's JIT needs ([`entitlements.mac.plist`](../apps/desktop/build/entitlements.mac.plist)), and notarizes with an App Store Connect API key. The identity comes only from these secrets. They use electron-builder's own names:

| Secret | What it holds |
| --- | --- |
| `CSC_LINK` | The Developer ID Application certificate and its private key, as a base64 `.p12` |
| `CSC_KEY_PASSWORD` | The `.p12`'s password |
| `APPLE_API_KEY` | The App Store Connect API key's `.p8` file contents. The job writes it to a temporary file. |
| `APPLE_API_KEY_ID` | That key's ID |
| `APPLE_API_ISSUER` | The key's issuer ID |

Without all five, the workflow still succeeds. Linux gets its feed. macOS builds unsigned, with no update feed, since macOS only installs updates signed like the running app. The run's summary and a warning say so.

### Setting up the `release` environment

Create and restrict the environment before you add any secret to it. If a nightly or stable run starts while it doesn't exist, GitHub creates it on first use with no protection rules, so it would accept any branch until you restrict it. Such a run has no secrets to read and builds macOS unsigned, but the environment stays open until you fix it.

In the repository's Settings:

1. Environments, New environment, named `release`.
2. Deployment branches and tags: Selected branches and tags. Add the branch rule `main` and nothing else. Nightly and stable runs are on `main`. A pushed tag runs the workflow from the tag's own commit, which can be on any branch, so no tag rule: a tag could otherwise read the secrets without review.
3. Add the five secrets above as environment secrets, not repository secrets.
4. Optionally, add yourself as a required reviewer, so each release waits for your approval before it can sign.

Then, under Actions, General, check that workflows from fork pull requests don't get secrets (the default), and that the workflow's token may create releases.

Once the first nightly by hand looks right, set `NIGHTLY_ENABLED` to `true` (above).

## Signing runnerbox.js

A server that updates itself from the app installs only a release signed by a key it trusts. The keys are the public ones in [`release-keys.json`](../release-keys.json), which `scripts/build.ts` writes into `runnerbox.js`. While that list is empty, nothing is signed and no server asks for a signature. The first release built after a key is in the list is the first one signed, and a server updated to it asks for a signature from then on.

The signature is Ed25519, over the release's version and the sha256 of `runnerbox.js`. It ships as `runnerbox.js.sig`. The `sign` job in the release workflow makes it, and it's the only job that can read the key: it runs in the `release` environment, which only `main` may use, gets the `cli` artifact alone, and has a token that can only read. It fails the release if the signature it made doesn't verify against `release-keys.json`, so a secret and a committed key that don't match are caught before anything ships. `publish` checks again and refuses to publish a release that should be signed and isn't.

A release made by pushing a tag runs from the tag's commit, which the `release` environment refuses, so it stays unsigned. A server that checks won't install it from the app, which gives the command to run on the machine instead.

### Adding the key

Do this on your own machine. Nobody else, and no agent, needs or should see the private key.

1. Make the key, readable only by you. This prints the public half as the entry `release-keys.json` takes; pick an `id` that says when it was made. It uses Node, since the `openssl` macOS ships (LibreSSL) can't make Ed25519 keys:

   ```bash
   node -e '
   const { generateKeyPairSync } = require("node:crypto");
   const { writeFileSync } = require("node:fs");
   const { privateKey, publicKey } = generateKeyPairSync("ed25519");
   writeFileSync("runnerbox-release-signing.pem", privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600, flag: "wx" });
   console.log(JSON.stringify({ id: "2026-11", publicKey: publicKey.export({ type: "spki", format: "pem" }) }, null, 2));
   '
   ```

2. In the repository's Settings, Environments, `release`, add an environment secret named `RUNNERBOX_RELEASE_SIGNING_KEY`. Its value is the whole file, the `BEGIN` and `END` lines included. On a Mac, `pbcopy < runnerbox-release-signing.pem` puts it on the clipboard.

3. The entry step 1 printed is public. Put it in the list in a pull request, or hand it to whoever opens one:

   ```json
   { "keys": [{ "id": "2026-11", "publicKey": "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA...\n-----END PUBLIC KEY-----\n" }] }
   ```

4. Keep the private key offline: copy `runnerbox-release-signing.pem` to an encrypted drive or your password manager, then delete it from the machine (`rm -P` on a Mac, `shred -u` on Linux). GitHub never shows a secret again once it's saved.

Add the secret before the pull request merges. If the list has a key and the environment doesn't, the next nightly or stable fails in `sign`, and nothing is published.

### If the key is lost or leaks

A lost key can't sign again. Servers that trust only that key won't install a release signed by a new one from the app, so each needs one manual install of a release whose list has the new key.

A leaked key is worse: whoever holds it can sign releases those servers accept, as long as they can also publish a release on this repository. Make a new key at once, put only the new key in the list, release, and install that release by hand on each machine. The app can't rotate away from a key the running server trusts.

### Rotating the key

Add the new key beside the old one in `release-keys.json` and release, still signed with the old key. Once servers are on that release, replace `RUNNERBOX_RELEASE_SIGNING_KEY` with the new key. Remove the old key from the list in a later release.

## What has and hasn't been exercised

The version rules and the planner are unit-tested. `release-check` packages Linux and unsigned macOS on pull requests and checks which feed each produces. Signing (the app's and `runnerbox.js`'s), notarization, publishing a release and installing an update haven't run yet: the first nightly run by hand after the secrets are added is their first test.

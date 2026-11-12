# Releases

Every release is a GitHub release in this repository, tagged `v<version>`, built by [`.github/workflows/release.yml`](../.github/workflows/release.yml). Each one carries `runnerbox.js` and `runnerbox.js.sha256`. Nightly and stable releases also carry the desktop app and the update feed the app reads.

| | How it starts | Version | Desktop app |
| --- | --- | --- | --- |
| Nightly | Every day at 06:17 UTC, from `main`, only when `main` changed since the last nightly | `X.Y.Z-nightly.YYYYMMDD.<run>`, a prerelease | yes, `nightly-*.yml` feed |
| Stable | Run the workflow by hand from `main` (Actions, release, Run workflow) | `X.Y.Z`, marked latest | yes, `latest-*.yml` feed |
| Tag | Push a `v*` tag yourself | the tag | no: `runnerbox.js` only, as before |

## Versions

A nightly's `X.Y.Z` is the stable it previews: one patch past the newest stable, or the version an earlier prerelease tag such as `v0.2.0-rc.3` was heading for, whichever is higher. A stable release promotes a nightly: it builds that nightly's commit again under the plain `X.Y.Z`. By default it promotes the latest nightly; the `nightly` input picks another. Only a nightly this workflow published, from a commit on `main`, counts: a tag someone pushed that merely looks like one is ignored. It refuses a version that's already released or isn't newer than the latest stable.

In semver, which the updater compares with, each nightly sorts above the stable before it and below the stable it previews. Later nightlies sort above earlier ones, by date and then by run number. So someone on nightly moves to the next stable when it ships, and the next nightly passes that stable. The workflow stamps the version into every `package.json` in its checkout, so `runnerbox.js`, `runnerbox serve` and the app all report it. Nothing is committed back.

`scripts/release-plan.ts` makes these decisions and `scripts/release-version.test.ts` tests them.

## Hosts that install by tag

Hosts download `runnerbox.js` from a release by its tag, and every release still carries it. Pushing a `v*` tag yourself still releases `runnerbox.js` alone, exactly as before; a tag with a hyphen, like `v0.2.0-rc.4`, becomes a prerelease. Tags the workflow creates for nightly and stable releases never start it again. Nightlies are prereleases, so GitHub's "latest release" is always the newest stable.

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

In the repository's Settings:

1. Environments, New environment, named `release`.
2. Deployment branches and tags: Selected branches and tags. Add the branch rule `main` and nothing else. Nightly and stable runs are on `main`. A pushed tag runs the workflow from the tag's own commit, which can be on any branch, so no tag rule: a tag could otherwise read the secrets without review.
3. Add the five secrets above as environment secrets, not repository secrets.
4. Optionally, add yourself as a required reviewer, so each release waits for your approval before it can sign.

Then, under Actions, General, check that workflows from fork pull requests don't get secrets (the default).

## What has and hasn't been exercised

The version rules and the planner are unit-tested. `release-check` packages Linux and unsigned macOS on pull requests and checks which feed each produces. Signing, notarization, publishing a release and installing an update haven't run yet: the first nightly after the secrets are added is their first test.

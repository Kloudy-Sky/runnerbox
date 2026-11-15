import assert from "node:assert/strict";
import { test } from "node:test";
import { RELEASE_VERSION } from "@runnerbox/contracts";
import semver from "semver";
import { compareVersions, EXACT, isExactVersion } from "./version.ts";

// The supervisor refuses a downgrade by this comparison, so it must agree with the semver package
// the release workflow and the app order versions with.
test("versions compare as semver does, nightlies included", () => {
  const versions = ["0.2.9", "0.3.0-rc.3", "0.3.0-nightly.20261113.40", "0.3.0-nightly.20261114.9", "0.3.0-nightly.20261114.41", "0.3.0", "0.3.1", "0.10.0", "1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0"];
  for (const a of versions) for (const b of versions) assert.equal(compareVersions(a, b), semver.compare(a, b), `${a} vs ${b}`);
});

test("only an exact version passes", () => {
  for (const version of ["0.3.2", "0.3.2-nightly.20261114.41"]) assert.ok(isExactVersion(version), version);
  for (const version of ["v0.3.2", "0.3", "latest", "0.3.2+build", "01.2.3", "0.3.2-", "../0.3.2", "0.3.2/../../x"]) assert.ok(!isExactVersion(version), version);
});

test("the app's check and the supervisor's are the same rule", () => {
  assert.equal(RELEASE_VERSION.source, EXACT.source);
});

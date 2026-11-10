// The GitHub Actions runner a host install unpacks for each job. Update the version and checksums
// together by hand, from the release's notes, and keep the version in step with image/Dockerfile.
const VERSION = "2.338.2";

export const RUNNER_RELEASE = {
  darwin: {
    url: `https://github.com/actions/runner/releases/download/v${VERSION}/actions-runner-osx-arm64-${VERSION}.tar.gz`,
    sha256: "25a065af409ffa317ab4d5a3b614dd15fc9c40f2172bc1b35a1b1258e919a388",
  },
  win32: {
    url: `https://github.com/actions/runner/releases/download/v${VERSION}/actions-runner-win-x64-${VERSION}.zip`,
    sha256: "a1f17aa987fc8158bc7521d284912267a0d01b7c2c4684b33c86783b5e8221cc",
  },
} as const;

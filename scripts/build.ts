// Bundles the CLI and server into dist/runnerbox.js, with the repository its releases come from
// built in when RUNNERBOX_UPDATE_REPO names one (owner/name), as the desktop build takes it:
//   RUNNERBOX_UPDATE_REPO=owner/name node scripts/build.ts [outfile]
// Without it, as from a checkout, the server knows no repository and can't update itself. The
// public keys in release-keys.json are written in too: with any, the server installs only releases
// signed by one of them.
import { build } from "esbuild";
import { readReleaseKeys } from "./release-keys.ts";

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const repository = process.env.RUNNERBOX_UPDATE_REPO ?? "";
if (repository !== "" && !REPOSITORY.test(repository)) {
  console.error(`RUNNERBOX_UPDATE_REPO is "${repository}", not owner/name.`);
  process.exit(1);
}

await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: process.argv[2] ?? "dist/runnerbox.js",
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  define: {
    RUNNERBOX_RELEASE_KEYS: JSON.stringify(readReleaseKeys()),
    ...(repository === "" ? {} : { RUNNERBOX_RELEASE_REPO: JSON.stringify(repository) }),
  },
});

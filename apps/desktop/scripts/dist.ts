// Packages the desktop app with electron-builder: macOS dmg and zip for Apple silicon and Intel,
// and a Linux x64 AppImage.
//   node scripts/dist.ts [--mac] [--linux]     (default: this machine's platform)
// The version is apps/desktop/package.json's, which the release workflow stamps; its channel
// follows from it (see scripts/release-version.ts).
//
// The release workflow also sets:
//   RUNNERBOX_UPDATE_REPO   owner/name whose GitHub releases are the update feed. Without it the
//                           app has no feed, so it never checks for updates.
//   CSC_LINK, CSC_KEY_PASSWORD, APPLE_API_KEY (a .p8 file's path), APPLE_API_KEY_ID,
//   APPLE_API_ISSUER        electron-builder's own names, for signing with a Developer ID and
//                           notarizing. Without them the macOS build is unsigned and gets no feed,
//                           since macOS only installs updates signed like the running app.
//
// Main and the preload are already single bundles (scripts/build.ts), so the app needs only those
// and the built web client. They're staged outside the workspace: inside it, electron-builder finds
// the pnpm workspace and packs its node_modules into the app.
import { access, cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Arch, build, Platform } from "electron-builder";
import { channelOf } from "../../../scripts/release-version.ts";

const here = resolve(import.meta.dirname, "..");
const web = resolve(here, "../web/dist");
const electronVersion = (await import("electron/package.json", { with: { type: "json" } })).default.version;
const { version } = JSON.parse(await readFile(join(here, "package.json"), "utf8")) as { version: string };
const channel = channelOf(version);

const wanted = process.argv.slice(2);
const mac = wanted.includes("--mac") || (wanted.length === 0 && process.platform === "darwin");
const linux = wanted.includes("--linux") || (wanted.length === 0 && process.platform === "linux");
if (!mac && !linux) throw new Error("Nothing to build: pass --mac or --linux.");

// Its inputs come from the builds `pnpm desktop:dist` runs first.
for (const input of [join(here, "dist", "main.cjs"), join(here, "dist", "preload.cjs"), join(web, "index.html")]) {
  await access(input).catch(() => {
    throw new Error(`${input} isn't built. Run pnpm desktop:dist, which builds it first.`);
  });
}

const APPLE = ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"] as const;
const present = APPLE.filter((name) => (process.env[name] ?? "") !== "");
// All or nothing: a half-configured identity would sign without notarizing, which macOS rejects.
if (mac && present.length > 0 && present.length < APPLE.length) {
  throw new Error(`Signing needs all of ${APPLE.join(", ")}; missing ${APPLE.filter((name) => !present.includes(name)).join(", ")}.`);
}
const signed = present.length === APPLE.length;
if (mac && !signed) {
  // electron-builder otherwise signs with any identity it finds in the keychain.
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
  console.log("macOS: no signing secrets, so this build is unsigned, and has no update feed.");
}

// `channel` picks the manifest electron-updater reads: latest-*.yml for stable, nightly-*.yml.
const updateRepo = process.env.RUNNERBOX_UPDATE_REPO ?? "";
const [owner, repo] = updateRepo.split("/");
const feed = owner && repo ? { provider: "github" as const, owner, repo, releaseType: channel === "nightly" ? ("prerelease" as const) : ("release" as const), ...(channel === "nightly" ? { channel } : {}) } : null;

// A fresh object for each build, since electron-builder changes the config it's given.
const base = () => ({
  appId: "io.runnerbox.desktop",
  productName: "runnerbox",
  electronVersion,
  directories: { output: join(here, "release") },
  files: ["main.cjs", "preload.cjs", "web/**", "package.json"],
  artifactName: "runnerbox-${version}-${arch}.${ext}",
  linux: { category: "Development" },
});

const stage = await mkdtemp(join(tmpdir(), "runnerbox-desktop-"));
try {
  await cp(join(here, "dist", "main.cjs"), join(stage, "main.cjs"));
  await cp(join(here, "dist", "preload.cjs"), join(stage, "preload.cjs"));
  await cp(web, join(stage, "web"), { recursive: true });
  await writeFile(
    join(stage, "package.json"),
    JSON.stringify({ name: "runnerbox", productName: "runnerbox", version, main: "main.cjs", description: "runnerbox desktop", author: "runnerbox" }, null, 2),
  );
  if (mac) {
    await build({
      projectDir: stage,
      // The updater installs from the zip; people install from the dmg.
      targets: Platform.MAC.createTarget(["dmg", "zip"], Arch.arm64, Arch.x64),
      config: {
        ...base(),
        mac: {
          category: "public.app-category.developer-tools",
          ...(signed
            ? { hardenedRuntime: true, entitlements: join(here, "build", "entitlements.mac.plist"), entitlementsInherit: join(here, "build", "entitlements.mac.plist"), notarize: true }
            : { identity: null }),
        },
        publish: signed ? feed : null,
      },
      publish: "never",
    });
  }
  if (linux) await build({ projectDir: stage, targets: Platform.LINUX.createTarget("AppImage", Arch.x64), config: { ...base(), publish: feed }, publish: "never" });
} finally {
  await rm(stage, { recursive: true, force: true });
}

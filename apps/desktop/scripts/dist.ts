// Packages the desktop app with electron-builder: an unsigned macOS dmg and a Linux AppImage.
//   node scripts/dist.ts [--mac] [--linux]     (default: this machine's platform)
// Main and the preload are already single bundles (scripts/build.ts), so the app needs only those
// and the built web client. They're staged outside the workspace: inside it, electron-builder finds
// the pnpm workspace and packs its node_modules into the app.
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Arch, build, Platform } from "electron-builder";

const here = resolve(import.meta.dirname, "..");
const stage = await mkdtemp(join(tmpdir(), "runnerbox-desktop-"));
const web = resolve(here, "../web/dist");
const electronVersion = (await import("electron/package.json", { with: { type: "json" } })).default.version;

const wanted = process.argv.slice(2);
// Apple silicon for macOS, x64 for Linux.
const targets = [
  ...(wanted.includes("--mac") || (wanted.length === 0 && process.platform === "darwin") ? [Platform.MAC.createTarget("dmg", Arch.arm64)] : []),
  ...(wanted.includes("--linux") || (wanted.length === 0 && process.platform === "linux") ? [Platform.LINUX.createTarget("AppImage", Arch.x64)] : []),
];
if (targets.length === 0) throw new Error("Nothing to build: pass --mac or --linux.");

await cp(join(here, "dist", "main.cjs"), join(stage, "main.cjs"));
await cp(join(here, "dist", "preload.cjs"), join(stage, "preload.cjs"));
await cp(web, join(stage, "web"), { recursive: true });
await writeFile(join(stage, "package.json"), JSON.stringify({ name: "runnerbox", productName: "runnerbox", version: "0.0.0", main: "main.cjs", description: "runnerbox desktop", author: "runnerbox" }, null, 2));

const config = {
  appId: "io.runnerbox.desktop",
  productName: "runnerbox",
  electronVersion,
  directories: { output: join(here, "release") },
  files: ["main.cjs", "preload.cjs", "web/**", "package.json"],
  // Not signed or notarized: macOS asks before the first open. See the README.
  mac: { identity: null, category: "public.app-category.developer-tools" },
  linux: { category: "Development" },
  publish: null,
};
try {
  for (const target of targets) await build({ projectDir: stage, targets: target, config });
} finally {
  await rm(stage, { recursive: true, force: true });
}

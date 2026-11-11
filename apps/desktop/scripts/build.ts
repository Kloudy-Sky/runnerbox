// Bundles main and the preload to CommonJS. The preload runs sandboxed, where only `electron`
// can be required, so everything else it uses is bundled in.
import { build, type BuildOptions } from "esbuild";

const shared: BuildOptions = { bundle: true, platform: "node", format: "cjs", target: "node22", external: ["electron"], logLevel: "info" };
await build({ ...shared, entryPoints: ["src/main.ts"], outfile: "dist/main.cjs" });
await build({ ...shared, entryPoints: ["src/preload.ts"], outfile: "dist/preload.cjs" });

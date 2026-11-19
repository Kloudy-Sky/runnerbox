import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const src = (path: string) => fileURLToPath(new URL(`./src/${path}`, import.meta.url)).replace(/\/$/, "");

export default defineConfig({
  // The repository whose releases this build came from, as the desktop feed takes it (apps/desktop/
  // scripts/dist.ts), so the command to update a server names that same repository. Empty when
  // built without one, from a checkout.
  define: { "import.meta.env.RUNNERBOX_RELEASE_REPO": JSON.stringify(process.env.RUNNERBOX_UPDATE_REPO ?? "") },
  // The same paths as tsconfig.json, for the code copied from T3 Code. Anchored, so one package's
  // alias never swallows another's subpath.
  resolve: {
    alias: [
      { find: /^~\//, replacement: `${src("")}/` },
      { find: /^@t3tools\/contracts(\/settings)?$/, replacement: src("lib/t3codeContracts.ts") },
      { find: /^@t3tools\/shared\/(.*)$/, replacement: `${src("t3tools/shared")}/$1` },
      { find: /^@t3tools\/client-runtime\/composer-model-mentions$/, replacement: src("t3tools/client-runtime/composerModelMentions.ts") },
      { find: /^@t3tools\/client-runtime\/(.*)$/, replacement: `${src("t3tools/client-runtime")}/$1` },
    ],
  },
  plugins: [react({ compiler: { logDiagnostics: true } }), tailwindcss()],
  server: { host: "127.0.0.1", port: 5733, strictPort: true },
  // Effect makes one large chunk, and the app loads from disk, so size matters less than for the web.
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 1500 },
});

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // The repository whose releases this build came from, as the desktop feed takes it (apps/desktop/
  // scripts/dist.ts), so the command to update a server names that same repository. Empty when
  // built without one, from a checkout.
  define: { "import.meta.env.RUNNERBOX_RELEASE_REPO": JSON.stringify(process.env.RUNNERBOX_UPDATE_REPO ?? "") },
  plugins: [react({ compiler: { logDiagnostics: true } }), tailwindcss()],
  server: { host: "127.0.0.1", port: 5733, strictPort: true },
  // Effect makes one large chunk, and the app loads from disk, so size matters less than for the web.
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 1500 },
});

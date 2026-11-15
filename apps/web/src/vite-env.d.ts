interface ImportMetaEnv {
  // See vite.config.ts.
  readonly RUNNERBOX_RELEASE_REPO: string;
}

interface Window {
  // T3 Code's desktop bridge, which the copied `timestampFormat.ts` reads for the system locale.
  // Runnerbox's desktop app never sets it, so timestamps use the browser's locale.
  readonly desktopBridge?: { readonly getSystemLocale: () => string | null };
}

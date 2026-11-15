import { join } from "node:path";
import { passedEnv } from "./agentEnv.ts";

// How Runnerbox runs the environment's own `codex`. Its home is Runnerbox's, under the server's
// directory, never the owner's `~/.codex`: that holds their config, hooks, MCP servers and login.
// The login in it is one the owner made for Runnerbox, with `runnerbox codex-login`.
export const codexHome = (serverDir: string) => join(serverDir, "agent", "codex-home");

// Only the shared allow-list reaches `codex`: an `OPENAI_API_KEY`, `CODEX_API_KEY`, `CODEX_HOME` or
// base URL in the server's environment never does. `apiKey` is the turn's account's own key, the only
// credential Runnerbox hands it.
export function codexEnv(from: Record<string, string | undefined>, home: string, apiKey: string | null = null) {
  return {
    ...passedEnv(from),
    CODEX_HOME: home,
    ...(apiKey === null ? {} : { CODEX_API_KEY: apiKey }),
  };
}

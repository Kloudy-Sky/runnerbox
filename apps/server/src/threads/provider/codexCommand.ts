import { join } from "node:path";
import { passedEnv } from "./agentEnv.ts";

// How Runnerbox runs the environment's own `codex`. Its home is Runnerbox's, under the server's
// directory, never the owner's `~/.codex`: that holds their config, hooks, MCP servers and login.
// The login in it is one the owner made for Runnerbox, with `runnerbox codex-login`.
export const codexHome = (serverDir: string) => join(serverDir, "agent", "codex-home");

// Only the shared allow-list reaches `codex`: an `OPENAI_API_KEY`, `CODEX_API_KEY`, `CODEX_HOME` or
// base URL in the server's environment never does, and Runnerbox hands it no key: it runs on the
// sign-in in Runnerbox's own home.
export const codexEnv = (from: Record<string, string | undefined>, home: string) => ({ ...passedEnv(from), CODEX_HOME: home });

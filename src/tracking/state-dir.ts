import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

// Where runnerbox keeps what it records, outside any checkout because job and branch names can be
// private. The XDG spec says to ignore a relative XDG_STATE_HOME, which could land in a checkout.
export function stateDir() {
  const configured = process.env.XDG_STATE_HOME;
  return join(configured && isAbsolute(configured) ? configured : join(homedir(), ".local", "state"), "runnerbox");
}

import { createClientRuntime } from "@runnerbox/client-runtime";
import { platform } from "./platform.ts";

// Every saved environment and its connection. A connection that comes back runs again each atom
// built on it, so the views refresh while what they last showed stays on screen.
export const runtime = createClientRuntime(platform);

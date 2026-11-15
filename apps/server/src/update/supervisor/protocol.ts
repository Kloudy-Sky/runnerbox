// What `serve`'s supervisor tells the server it runs. The supervisor loads nothing but Node's own
// modules, so this file imports nothing at all.

// Set on the server the supervisor starts, which tells it not to start a supervisor of its own.
export const SUPERVISED_ENV = "RUNNERBOX_SERVE_SUPERVISED";

// Bumped when a message changes shape. A supervisor stays in memory across an update, so a new
// server can find itself under an older one.
export const SUPERVISOR_PROTOCOL = 1;

// What the server learns from SUPERVISED_ENV. `file` is the runnerbox.js the service manager runs.
export type ChildContext = { readonly protocol: number; readonly file: string; readonly role: "active" };

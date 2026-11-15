// What `serve`'s supervisor and the server it runs say to each other. The supervisor loads nothing
// but Node's own modules, so this file imports nothing at all and checks messages by hand.

// Set on the server the supervisor starts, which tells it not to start a supervisor of its own.
export const SUPERVISED_ENV = "RUNNERBOX_SERVE_SUPERVISED";

// Bumped when a message changes shape. A supervisor stays in memory across an update, so a new
// server can find itself under an older one.
export const SUPERVISOR_PROTOCOL = 1;

// What the server learns from SUPERVISED_ENV. `file` is the runnerbox.js the service manager runs,
// which a server on trial isn't running from. A trial carries the update it's on trial for.
export type ChildContext =
  | { readonly protocol: number; readonly file: string; readonly role: "active" }
  | { readonly protocol: number; readonly file: string; readonly role: "trial"; readonly updateId: string };

// Server to supervisor. `ready` once every listener is bound. `update` asks to move to a release
// the server has downloaded to `path` and checked against `sha256`.
export type ChildMessage =
  | { readonly type: "ready"; readonly version: string }
  | { readonly type: "update"; readonly version: string; readonly path: string; readonly sha256: string };

// Supervisor to server, answering `update`. Once accepted, the supervisor stops this server.
export type SupervisorMessage = { readonly type: "update-accepted"; readonly id: string } | { readonly type: "update-refused"; readonly reason: string };

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isText = (value: unknown, max = 4096): value is string => typeof value === "string" && value.length > 0 && value.length <= max;

export function decodeChildMessage(value: unknown): ChildMessage | null {
  if (!isRecord(value)) return null;
  if (value.type === "ready" && isText(value.version, 256)) return { type: "ready", version: value.version };
  if (value.type === "update" && isText(value.version, 256) && isText(value.path) && typeof value.sha256 === "string" && /^[0-9a-f]{64}$/.test(value.sha256)) {
    return { type: "update", version: value.version, path: value.path, sha256: value.sha256 };
  }
  return null;
}

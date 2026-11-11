// The commands runnerbox.js hands to the server. Kept apart from the server's code, so the CLI can
// tell a server command from its own without loading any of it.
export const SERVER_COMMANDS: ReadonlyArray<string> = ["serve", "pair", "mcp-token", "link", "unlink", "link-status"];

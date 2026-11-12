import * as Context from "effect/Context";
import type * as AuthStore from "../auth/AuthStore.ts";

// The session whose token made an `/mcp` request, as the route's auth checked it. Tools that act
// for a session read it here instead of reading the token again.
export class McpSession extends Context.Service<McpSession, AuthStore.Session>()("runnerbox/server/mcp/McpSession") {}

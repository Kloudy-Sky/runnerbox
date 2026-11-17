import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// The App a test server signs in through, and the token its stand-in for GitHub takes.
export const TEST_APP = { clientId: "Iv1.test", slug: "example-app", name: "Example App" };
export const USER_TOKEN = "not-a-real-user-token";

// Signs a server in as octocat before it starts, by writing the session the device flow would
// have left. `session` changes what it holds, such as a token that has expired.
export async function writeGitHubSession(stateDir: string, session: { readonly accessToken?: string; readonly accessTokenExpiresAt?: number | null; readonly refreshToken?: string | null } = {}) {
  const serverDir = join(stateDir, ".server");
  await mkdir(serverDir, { recursive: true, mode: 0o700 });
  await writeFile(join(serverDir, "github-session.json"), JSON.stringify({ v: 1, account: "octocat", accessToken: USER_TOKEN, accessTokenExpiresAt: null, refreshToken: null, refreshTokenExpiresAt: null, ...session }), { mode: 0o600 });
}

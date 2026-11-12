import { realpath } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { type } from "arktype";
import { GITHUB_API, githubHeaders } from "../github/github-client.ts";
import { readTokenFile } from "../launcher/token-file.ts";

// A commit's files for a reproduce, fetched on the host with a token that can only read code, so
// neither that token nor the one that mints runners ever reaches the VM.

const MAX_TARBALL_BYTES = 512 * 1024 * 1024;

// Reads the source token, and refuses the file that mints runners, by path or by contents.
export async function readSourceToken(sourceTokenFile: string, mintingTokenFile: string) {
  const same = "reproduce.sourceTokenFile must not be the token that mints runners. Give it a token that can only read code (Contents: read).";
  if ((await realpath(sourceTokenFile)) === (await realpath(mintingTokenFile).catch(() => null))) throw new Error(same);
  const token = await readTokenFile(sourceTokenFile);
  if (token === (await readTokenFile(mintingTokenFile).catch(() => null))) throw new Error(same);
  return token;
}

const Repository = type({ private: "boolean" });

// A public repository's commit could be a stranger's pull request, and a reproduce shares the VM
// with your jobs, so only private repositories are reproduced.
export async function checkPrivateRepo(repo: string, token: string, fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl(`${GITHUB_API}/repos/${repo}`, { headers: githubHeaders(token) });
  if (response.status === 404 || response.status === 403) throw new Error(`The source token can't read ${repo}. Give it Contents: read on that repository.`);
  if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${repo}.`);
  const body = Repository(await response.json());
  if (body instanceof type.errors) throw new Error(`GitHub's answer for ${repo} wasn't a repository.`);
  if (!body.private) throw new Error(`${repo} is public. Reproduce only runs private repositories' code, since it shares the VM with your jobs.`);
}

// The commit's tarball as a stream, cut off past 512 MiB.
export async function commitTarball(repo: string, commit: string, token: string, fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl(`${GITHUB_API}/repos/${repo}/tarball/${commit}`, { headers: githubHeaders(token), redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`Couldn't download ${repo} at ${commit.slice(0, 7)}: GitHub answered ${response.status}.`);
  let seen = 0;
  const capped = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      seen += chunk.length;
      done(seen > MAX_TARBALL_BYTES ? new Error(`${repo} at ${commit.slice(0, 7)} is over 512 MiB.`) : null, chunk);
    },
  });
  const reader = response.body.getReader();
  const chunks = async function* () {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  };
  const body = Readable.from(chunks());
  body.on("error", (error) => capped.destroy(error));
  return body.pipe(capped);
}

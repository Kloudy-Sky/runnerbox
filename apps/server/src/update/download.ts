import { createHash } from "node:crypto";
import { open, rm, statfs } from "node:fs/promises";
import { dirname } from "node:path";

// Where releases are downloaded from. In a release, GitHub: the repository built into it, with
// redirects only to GitHub's own download hosts. Tests point it at a local server.
export type ReleaseSource = {
  readonly releaseUrl: (version: string) => string;
  readonly redirectAllowed: (url: URL) => boolean;
};

export const githubReleases = (repository: string): ReleaseSource => ({
  releaseUrl: (version) => `https://github.com/${repository}/releases/download/v${version}/`,
  redirectAllowed: (url) => url.protocol === "https:" && (url.hostname === "github.com" || url.hostname.endsWith(".githubusercontent.com")),
});

// runnerbox.js is about 10 MB. Anything past this isn't one.
export const MAX_BYTES = 64 * 1024 * 1024;

type DownloadFailure = "download-failed" | "disk-full" | "unsigned" | "bad-signature";

export class DownloadError extends Error {
  readonly kind: DownloadFailure;
  constructor(kind: DownloadFailure, message: string) {
    super(message);
    this.kind = kind;
  }
}

const MAX_REDIRECTS = 5;

// GET, following redirects only where the source allows.
async function get(source: ReleaseSource, url: string, signal: AbortSignal): Promise<Response> {
  let current = new URL(url);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetch(current, { redirect: "manual", signal }).catch((error: unknown) => {
      throw new DownloadError("download-failed", `GitHub couldn't be reached: ${error instanceof Error ? error.message : String(error)}`);
    });
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || location === null) {
      if (!response.ok) throw new DownloadError("download-failed", `GitHub answered ${response.status} for ${current.pathname.split("/").at(-1)}.`);
      return response;
    }
    await response.body?.cancel();
    const next = new URL(location, current);
    if (!source.redirectAllowed(next)) throw new DownloadError("download-failed", `The download was sent to ${next.host}, which isn't GitHub.`);
    current = next;
  }
  throw new DownloadError("download-failed", "The download was redirected too many times.");
}

// The sha256 a release lists for runnerbox.js, from its `sha256sum` line.
export async function fetchChecksum(source: ReleaseSource, version: string, signal: AbortSignal) {
  const response = await get(source, `${source.releaseUrl(version)}runnerbox.js.sha256`, signal);
  const text = (await response.text()).slice(0, 1024);
  const match = /^([0-9a-f]{64})\s+\*?runnerbox\.js\s*$/m.exec(text);
  if (!match?.[1]) throw new DownloadError("download-failed", "The release's checksum file isn't one sha256sum wrote for runnerbox.js.");
  return match[1];
}

// The release's runnerbox.js.sig, or null when it has none.
export async function fetchSignature(source: ReleaseSource, version: string, signal: AbortSignal) {
  try {
    const response = await get(source, `${source.releaseUrl(version)}runnerbox.js.sig`, signal);
    return (await response.text()).slice(0, 200).trim();
  } catch (error) {
    if (error instanceof DownloadError && /answered 404/.test(error.message)) return null;
    throw error;
  }
}

const isFullDisk = (error: unknown) => error instanceof Error && "code" in error && (error.code === "ENOSPC" || error.code === "EDQUOT");

// Downloads runnerbox.js to `path`, owner-only, reporting bytes as they arrive, and returns its
// sha256. Refuses before writing when the disk hasn't room for it three times over: the download,
// the old file's copy, and room to spare. Leaves nothing behind when it fails.
export async function downloadRelease(
  source: ReleaseSource,
  version: string,
  path: string,
  onProgress: (received: number, total: number | null) => void,
  signal: AbortSignal,
): Promise<string> {
  const response = await get(source, `${source.releaseUrl(version)}runnerbox.js`, signal);
  const length = Number(response.headers.get("content-length") ?? Number.NaN);
  const total = Number.isFinite(length) ? length : null;
  if (total !== null && total > MAX_BYTES) throw new DownloadError("download-failed", `The download is ${Math.round(total / 1024 / 1024)} MB, too big to be runnerbox.js.`);
  const space = await statfs(dirname(path));
  const needed = 3 * (total ?? MAX_BYTES);
  if (space.bavail * space.bsize < needed) throw new DownloadError("disk-full", `Not enough disk space: it needs ${Math.ceil(needed / 1024 / 1024)} MB free beside runnerbox.js.`);
  const hash = createHash("sha256");
  const file = await open(path, "w", 0o600);
  let received = 0;
  try {
    if (response.body === null) throw new DownloadError("download-failed", "GitHub sent an empty download.");
    for await (const chunk of response.body) {
      received += chunk.byteLength;
      if (received > MAX_BYTES) throw new DownloadError("download-failed", "The download is too big to be runnerbox.js.");
      hash.update(chunk);
      await file.write(chunk);
      onProgress(received, total);
    }
    await file.sync();
  } catch (error) {
    await file.close();
    await rm(path, { force: true });
    if (isFullDisk(error)) throw new DownloadError("disk-full", "The disk filled up during the download.");
    if (error instanceof DownloadError) throw error;
    throw new DownloadError("download-failed", `The download stopped: ${error instanceof Error ? error.message : String(error)}`);
  }
  await file.close();
  return hash.digest("hex");
}

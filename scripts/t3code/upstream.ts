// Reads a T3 Code checkout through git, without fetching or touching its branch and working tree.
import { execFileSync, spawnSync } from "node:child_process";

export function upstreamCheckout(dir: string) {
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "buffer", maxBuffer: 1024 ** 3 });
  const succeeds = (...args: string[]) => spawnSync("git", ["-C", dir, ...args]).status === 0;

  return {
    // The full commit a ref names, or undefined when the checkout doesn't have it.
    resolve: (ref: string) =>
      succeeds("rev-parse", "--verify", "--quiet", `${ref}^{commit}`) ? git("rev-parse", `${ref}^{commit}`).toString().trim() : undefined,
    // Whether a file or directory exists at a commit.
    has: (commit: string, path: string) => succeeds("cat-file", "-e", `${commit}:${path}`),
    read: (commit: string, path: string) => git("show", `${commit}:${path}`),
    // How many commits between the two touched any of these paths.
    commitsTouching: (from: string, to: string, paths: ReadonlyArray<string>) =>
      Number(git("rev-list", "--count", `${from}..${to}`, "--", ...paths).toString().trim()),
    // Whether any of these paths differ between the two commits.
    differs: (from: string, to: string, paths: ReadonlyArray<string>) => !succeeds("diff", "--quiet", from, to, "--", ...paths),
  };
}

export type UpstreamCheckout = ReturnType<typeof upstreamCheckout>;

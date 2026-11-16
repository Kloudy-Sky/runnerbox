// Lockfiles and generated files: a reviewer can't judge them line by line, and one dependency bump
// would crowd out the change itself.
const NOT_REVIEWED = /(^|\/)(pnpm-lock\.yaml|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|bun\.lockb?|Cargo\.lock|go\.sum|composer\.lock|Gemfile\.lock|poetry\.lock|uv\.lock|Podfile\.lock|flake\.lock)$|\.min\.(js|css)$|\.map$|\.snap$/;

// The path a file's part of a diff is about: its new name, or for a deleted file its old one.
const pathOf = (part: string) => /^\+\+\+ b\/(.+)$/m.exec(part)?.[1] ?? /^diff --git a\/(.+) b\/\1$/m.exec(part)?.[1];

// A pull request's diff as the reviewer gets it: each lockfile or generated file replaced by a line
// saying it isn't shown. `changedLines` counts the added and removed lines that are left.
export function reviewableDiff(diff: string) {
  let changedLines = 0;
  const parts = diff.split(/^(?=diff --git )/m).map((part) => {
    const path = pathOf(part);
    if (path !== undefined && NOT_REVIEWED.test(path)) return `diff --git a/${path} b/${path}\n(a lockfile or generated file, not shown)\n`;
    // Only lines inside hunks count, so the `---` and `+++` lines naming the file don't.
    const hunks = part.search(/^@@ /m);
    if (hunks !== -1) changedLines += part.slice(hunks).split("\n").filter((line) => /^[+-]/.test(line)).length;
    return part;
  });
  return { diff: parts.join(""), changedLines };
}

// A unified diff of one file that `git apply` takes, with three lines of context. Move CI's edits
// never add or remove a line, so `before` and `after` have the same lines but for the changed ones.

const CONTEXT = 3;
const NO_NEWLINE = "\\ No newline at end of file";

const linesOf = (text: string) => {
  const lines = text.split("\n");
  const ends = lines.at(-1) === "";
  if (ends) lines.pop();
  return { lines, ends };
};

export function unifiedDiff(path: string, before: string, after: string): string {
  const old = linesOf(before);
  const next = linesOf(after);
  if (old.lines.length !== next.lines.length) throw new Error("Move CI's edits change lines, never add or remove them.");
  const last = old.lines.length - 1;
  const changed = old.lines.flatMap((line, index) => (line === next.lines[index] ? [] : [index]));
  if (changed.length === 0) return "";
  // Each hunk is a run of lines whose context touches or overlaps the next.
  const hunks: Array<{ from: number; to: number }> = [];
  for (const index of changed) {
    const from = Math.max(0, index - CONTEXT);
    const to = Math.min(last, index + CONTEXT);
    const previous = hunks.at(-1);
    if (previous && from <= previous.to + 1) previous.to = to;
    else hunks.push({ from, to });
  }
  const out = [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`];
  const marked = (line: string, index: number, ends: boolean) => (index === last && !ends ? [line, NO_NEWLINE] : [line]);
  for (const { from, to } of hunks) {
    const count = to - from + 1;
    out.push(`@@ -${from + 1},${count} +${from + 1},${count} @@`);
    for (let index = from; index <= to; index += 1) {
      const was = old.lines[index] ?? "";
      const now = next.lines[index] ?? "";
      if (was === now) out.push(...marked(` ${was}`, index, old.ends));
      else out.push(...marked(`-${was}`, index, old.ends), ...marked(`+${now}`, index, next.ends));
    }
  }
  return `${out.join("\n")}\n`;
}

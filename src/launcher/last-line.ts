// The longest line kept. It's a runner's output shown in the app, so it stays short.
export const LAST_LINE_MAX = 200;

// Docker prints this after its own error, and it never says why.
const DOCKER_HINT = /^(See|Run) 'docker [^']*--help'/;
const ANSI = /\u001b\[[\d;?]*[A-Za-z]/g;
// A line that never ends still only needs its start.
const PARTIAL_MAX = 4096;

// Keeps the last meaningful line of output that arrives in chunks, such as "docker: Cannot connect
// to the Docker daemon", so a runner that failed to start can say why. Escape codes and control
// characters go, blank lines and Docker's help hint are skipped, and the line is cut short.
export function createLastLine() {
  let partial = "";
  let last: string | null = null;
  const consider = (raw: string) => {
    const line = raw.replace(ANSI, "").replace(/[\p{Cc}\p{Cf}\s]+/gu, " ").trim();
    if (line && !DOCKER_HINT.test(line)) last = line.slice(0, LAST_LINE_MAX);
  };
  return {
    push(text: string) {
      const lines = (partial + text).split(/[\r\n]/);
      partial = (lines.pop() ?? "").slice(0, PARTIAL_MAX);
      for (const line of lines) consider(line);
    },
    // Includes a last line that never got its newline.
    last() {
      consider(partial);
      partial = "";
      return last;
    },
  };
}

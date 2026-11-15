// The job a runner just took, from the line it prints when it starts one, such as
// "2026-11-15 03:00:00Z: Running job: test". A job could print a line like it into the
// container's output, so the name is only ever shown, as text, and cut short.
export function jobFromRunnerLine(line: string) {
  const name = /: Running job: (.+)$/.exec(line.trim())?.[1]?.trim();
  return name ? name.slice(0, 100) : null;
}

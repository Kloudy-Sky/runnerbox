export function formatDuration(ms: number | null | undefined) {
  if (ms === null || ms === undefined) return "-";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function formatAge(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return "-";
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

export const formatMiB = (value: number | null | undefined) =>
  value === null || value === undefined ? "-" : value >= 1024 ? `${(value / 1024).toFixed(1)} GiB` : `${Math.round(value)} MiB`;

export const formatPercent = (part: number, whole: number) => (whole === 0 ? "-" : `${((part / whole) * 100).toFixed(1)}%`);

export const jobName = (row: { workflow: string | null; job: string }) => (row.workflow ? `${row.workflow} / ${row.job}` : row.job);

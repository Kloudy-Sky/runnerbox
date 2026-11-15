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

// Memory for the owner: GB to one decimal from 1024 MiB, whole MB below. It's 1024-based, but
// labelled GB and MB, which is what people call them. The server's sentences use the same rule
// (`memory` in apps/server/src/inbox/jobs.ts); change both together. Config keys keep their names.
export const formatMiB = (value: number | null | undefined) =>
  value === null || value === undefined ? "-" : value >= 1024 ? `${(value / 1024).toFixed(1)} GB` : `${Math.round(value)} MB`;

// A part and its whole in the whole's unit, so "X of Y" never mixes MB and GB: "0.6 GB" of
// "16.0 GB". A part that would round to 0.0 GB is "under 0.1 GB". Mirrors `memoryOf` on the server.
export const formatMiBOf = (part: number, whole: number) => ({
  part: whole < 1024 ? formatMiB(part) : part < 0.05 * 1024 ? "under 0.1 GB" : `${(part / 1024).toFixed(1)} GB`,
  whole: formatMiB(whole),
});

export const formatPercent = (part: number, whole: number) => (whole === 0 ? "-" : `${((part / whole) * 100).toFixed(1)}%`);

export const jobName = (row: { workflow: string | null; job: string }) => (row.workflow ? `${row.workflow} / ${row.job}` : row.job);

// A file's size as people read it: bytes, KB or MB.
export const formatBytes = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

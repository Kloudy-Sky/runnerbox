// Hours on a machine, as a total reads best: "31h", or minutes under an hour.
export const hoursText = (ms: number) => (ms < 3_600_000 ? `${Math.round(ms / 60_000)}m` : `${Math.round(ms / 3_600_000).toLocaleString()}h`);

export const percentText = (part: number, whole: number) => (whole === 0 ? null : `${Math.round((part / whole) * 100)}%`);

export const usdText = (usd: number) => `$${usd.toFixed(2)}`;

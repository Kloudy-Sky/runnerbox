// Days on the host's own calendar, so a laptop's night falls inside one day rather than across two
// UTC days. Built from local midnights, so a day that changes the clock is 23 or 25 hours long.

const pad = (value: number) => String(value).padStart(2, "0");

export const dayKey = (ms: number) => {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

// The local midnight that starts the day `ms` falls in, `offset` days later.
export const dayStart = (ms: number, offset = 0) => {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset).getTime();
};

// The start of every day from the one holding `from` to the one holding `to`, oldest first.
export const daysBetween = (from: number, to: number) => {
  const starts: number[] = [];
  for (let start = dayStart(from); start <= to; start = dayStart(start, 1)) starts.push(start);
  return starts;
};

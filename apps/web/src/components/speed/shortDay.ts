// A host's calendar day, "2026-11-17", as "17 Nov". Read at noon UTC so no time zone moves it.
export const shortDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short" });

// Which links the app hands to the system browser: only https pages on github.com, such as a run
// to rerun. Anything else a page tries to open is refused.
export function opensInBrowser(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "github.com" && parsed.username === "" && parsed.password === "";
  } catch {
    return false;
  }
}

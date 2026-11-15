// Which links the app hands to the system browser: only https pages on github.com, such as a run
// to rerun. Desktop main enforces it on anything a page tries to open, and the web client renders
// any other link as text, so it never offers one that would be refused.
export function opensInBrowser(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "github.com" && parsed.username === "" && parsed.password === "";
  } catch {
    return false;
  }
}

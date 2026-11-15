// A ref callback that writes `format(now)` into a node, then again once a second, as T3 Code's
// `tickTextContent` does on its shared tick, but only while the window is visible: a hidden window
// stops the one shared timer, and showing it again writes the current text at once. Nothing but
// the text changes, so nothing repaints between ticks.
const writers = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

const writeAll = () => {
  for (const write of writers) write();
};

const sync = () => {
  const run = writers.size > 0 && document.visibilityState === "visible";
  if (run && timer === undefined) timer = setInterval(writeAll, 1000);
  if (!run && timer !== undefined) {
    clearInterval(timer);
    timer = undefined;
  }
};

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    sync();
    if (document.visibilityState === "visible") writeAll();
  });
}

export const tickText = (format: (nowMs: number) => string) => (node: HTMLElement | null) => {
  if (!node) return;
  const write = () => {
    const text = format(Date.now());
    if (node.textContent !== text) node.textContent = text;
  };
  write();
  writers.add(write);
  sync();
  return () => {
    writers.delete(write);
    sync();
  };
};

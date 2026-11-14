import { useEffect, useRef, useState } from "react";

// What T3 Code's copied toast uses to copy an error's text, with the same shape as theirs. Theirs
// also carries rich clipboard formats for their composer, which runnerbox doesn't have.
export function useCopyToClipboard<TContext = void>({ timeout = 2000 }: { timeout?: number; target?: string } = {}) {
  const [isCopied, setIsCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const copyToClipboard = (value: string, _context: TContext) => {
    void navigator.clipboard.writeText(value).then(() => {
      if (timer.current) clearTimeout(timer.current);
      setIsCopied(true);
      timer.current = setTimeout(() => setIsCopied(false), timeout);
    });
  };
  return { copyToClipboard, isCopied };
}

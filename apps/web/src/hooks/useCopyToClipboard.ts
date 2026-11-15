// A stand-in of runnerbox's, not T3 Code's file: what the copied toast and copy button use to copy
// text, in the same shape as theirs, without the rich clipboard formats their composer needs.
import { useEffect, useRef, useState } from "react";

export function useCopyToClipboard<TContext = void>({
  timeout = 2000,
  onError,
}: { timeout?: number; target?: string; onError?: (error: Error) => void; extraFlavors?: Readonly<Record<string, string>> } = {}) {
  const [isCopied, setIsCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const copyToClipboard = (value: string, _context: TContext) => {
    navigator.clipboard.writeText(value).then(
      () => {
        if (timer.current) clearTimeout(timer.current);
        setIsCopied(true);
        timer.current = setTimeout(() => setIsCopied(false), timeout);
      },
      (cause: unknown) => onError?.(cause instanceof Error ? cause : new Error(String(cause))),
    );
  };
  return { copyToClipboard, isCopied };
}

// A stand-in of runnerbox's, not T3 Code's file: T3 Code finds `$...$` math with remark, so mentions
// inside a formula aren't chips. Runnerbox doesn't render math and doesn't take remark's packages
// for this, so no text is math.
export type MarkdownMathRange = {
  start: number;
  end: number;
  source: string;
  tex: string;
  display: boolean;
  inTable: boolean;
};

export const markdownMathRanges = (_source: string, _tree?: unknown): Array<MarkdownMathRange> => [];

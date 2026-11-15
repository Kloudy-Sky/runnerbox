// A stand-in of runnerbox's, not T3 Code's file: a code block in the composer, plain:
// runnerbox has no syntax highlighting or language picker.
import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";

export function ComposerCodeBlockNodeView() {
  return (
    <NodeViewWrapper className="my-1 rounded-md bg-muted/40">
      <pre className="max-w-full overflow-x-auto px-3 py-2">
        <NodeViewContent<"code"> as="code" className="block min-h-[1lh] font-mono text-[13px] whitespace-pre-wrap [overflow-wrap:anywhere]" />
      </pre>
    </NodeViewWrapper>
  );
}

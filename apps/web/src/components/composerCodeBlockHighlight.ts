// A stand-in of runnerbox's, not T3 Code's file: T3 Code's code-block highlighter. Runnerbox
// leaves code unhighlighted, so this adds nothing to the editor.
import { Extension } from "@tiptap/core";

export const composerCodeBlockHighlight = (_options: { resolveTheme: () => string }): Extension => Extension.create({ name: "composerCodeBlockHighlight" });

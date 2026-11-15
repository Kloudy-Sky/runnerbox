// A stand-in of runnerbox's, not T3 Code's file: a `model:` mention's chip. Runnerbox picks the model
// beside the composer, not in the text, so no mention is ever a known model.
import type { StandInAtom } from "../../t3tools/atom-react.ts";

export function ModelMentionChip({ source }: { environmentId: unknown; instanceId: string; model: string; source: string }) {
  return <span>{source}</span>;
}

export const modelMentionKey = (instanceId: string, model: string) => `${instanceId}/${model}`;

const NONE: StandInAtom<ReadonlySet<string>> = { value: new Set() };
export const modelMentionKeysAtom = (_environmentId: string) => NONE;

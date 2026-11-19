import { useState } from "react";
import { type Answer, keptAnswer } from "../lib/keptAnswer.ts";

// An answer whose key changes with the page, such as its range, keeping the last key's data on
// screen while the new key's loads.
export function useKept<A>(answer: Answer<A>) {
  const [kept, setKept] = useState(answer.data);
  if (answer.data !== undefined && answer.data !== kept) setKept(answer.data);
  return keptAnswer(answer, kept);
}

import { useState } from "react";

type Answer<A> = { readonly data: A | undefined; readonly isSuccess: boolean; readonly isError: boolean };

// An answer whose key changes with the page, such as its range, keeping the last key's data on
// screen while the new key's loads, as React Query's keepPreviousData did. `isPlaceholderData` is
// true while that last data is what shows.
export function useKept<A>(answer: Answer<A>) {
  const [kept, setKept] = useState(answer.data);
  if (answer.data !== undefined && answer.data !== kept) setKept(answer.data);
  return answer.data !== undefined ? { ...answer, isPlaceholderData: false } : { ...answer, data: kept, isPlaceholderData: kept !== undefined };
}

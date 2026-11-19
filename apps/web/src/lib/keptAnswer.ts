export type Answer<A> = { readonly data: A | undefined; readonly isSuccess: boolean; readonly isError: boolean };

// What a view shows for an answer whose key just changed, given the data its last key had: that
// data, marked as a placeholder, while the new key loads, as React Query's keepPreviousData did.
// Once the new key answers or fails, it shows as it is.
export const keptAnswer = <A>(answer: Answer<A>, kept: A | undefined) =>
  answer.data !== undefined || answer.isError ? { ...answer, isPlaceholderData: false } : { ...answer, data: kept, isPlaceholderData: kept !== undefined };

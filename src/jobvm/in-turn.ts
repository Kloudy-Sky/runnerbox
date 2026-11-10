// Runs tasks one at a time, in the order they were given. Builds and disk copies both need the
// builder to themselves: a copy shuts it down, which would cut a build short.
export function createTurns() {
  let last: Promise<unknown> = Promise.resolve();
  return function inTurn<Result>(task: () => Promise<Result>) {
    const turn = last.then(task);
    last = turn.catch(() => {});
    return turn;
  };
}

export type InTurn = ReturnType<typeof createTurns>;

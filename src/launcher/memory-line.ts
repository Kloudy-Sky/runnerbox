// Hands out room for jobs in the order slots asked for it, across every runner type. Without it, a
// slot whose job just ended asks again at once and takes the memory another slot has been waiting
// for, since a waiting slot only checks every few seconds.
export function createMemoryLine(roomForJob: () => Promise<string | null>) {
  const line: object[] = [];
  // A slot joins before it registers a runner and leaves once it may, or when it stops waiting.
  return function join() {
    const place = {};
    line.push(place);
    return {
      // Why this slot can't start yet, or null once it's first in line and memory is above the floor.
      async room() {
        const ahead = line.indexOf(place);
        if (ahead > 0) return `${ahead} ${ahead === 1 ? "slot was" : "slots were"} waiting first`;
        return roomForJob();
      },
      leave() {
        const index = line.indexOf(place);
        if (index >= 0) line.splice(index, 1);
      },
    };
  };
}

export type JoinMemoryLine = ReturnType<typeof createMemoryLine>;

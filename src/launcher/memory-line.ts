import type { MemoryFloor } from "./launcher-config.ts";

// Hands out room for jobs in the order slots asked for it, across every runner type. Without it, a
// slot whose job just ended asks again at once and takes the memory another slot has been waiting
// for, since a waiting slot only checks every few seconds.
// A slot waits only behind slots whose floor is no higher than its own on either machine. One that
// needs more can't start yet anyway, so it shouldn't hold up a lighter kind's slot that fits.
export function createMemoryLine(roomForJob: (floor: MemoryFloor) => Promise<string | null>) {
  const line: MemoryFloor[] = [];
  const needsNoMore = (ahead: MemoryFloor, floor: MemoryFloor) =>
    ahead.hostMiB <= floor.hostMiB && ahead.vmMiB <= floor.vmMiB;
  // A slot joins before it registers a runner and leaves once it may, or when it stops waiting.
  return function join(floor: MemoryFloor) {
    // A copy, so two slots sharing one floor object still hold separate places.
    const place = { ...floor };
    line.push(place);
    return {
      // Why this slot can't start yet, or null once no slot ahead of it blocks it and memory is above its floor.
      async room() {
        const ahead = line.slice(0, line.indexOf(place)).filter((other) => needsNoMore(other, place)).length;
        if (ahead > 0) return `${ahead} ${ahead === 1 ? "slot was" : "slots were"} waiting first`;
        return roomForJob(place);
      },
      leave() {
        const index = line.indexOf(place);
        if (index >= 0) line.splice(index, 1);
      },
    };
  };
}

// One slot's place in the line.
export type MemoryTurn = ReturnType<ReturnType<typeof createMemoryLine>>;

import type { InTurn } from "./in-turn.ts";
import { untilAnswers } from "./until-answers.ts";
import type { Virsh } from "./virsh.ts";

const BUILDER_TIMEOUT_MS = 3 * 60_000;

type Builder = {
  install: string;
  // The builder's libvirt domain. `vm render` names its disk `<domain>.qcow2`.
  domain: string;
  pool: string;
};

type GoldenActions = {
  virsh: Virsh;
  inTurn: InTurn;
  // The builder's Docker images, one `name:tag` per line. Fails while the builder is down.
  builderTags: () => Promise<string>;
  wait: (ms: number) => Promise<void>;
  now: () => number;
  log: (message: string) => void;
};

// Keeps a golden copy of the builder's disk for job VMs to boot from. A copy is taken with the
// builder shut down, so it's always consistent, and nothing else changes it afterwards: jobs write
// to their own thin layer on top. Jobs never run in the builder itself.
export function createGoldenDisk({ install, domain, pool }: Builder, actions: GoldenActions) {
  const { virsh, inTurn, builderTags, wait, now, log } = actions;
  const clock = { wait, now };
  let current: { volume: string; tags: Set<string> } | null = null;
  const holds = new Map<string, number>();

  const state = async () => (await virsh(["domstate", domain])).trim();
  const lacks = (tag?: string) => !current || (tag !== undefined && !current.tags.has(tag));

  async function publish() {
    if ((await state()) !== "running") await virsh(["start", domain]);
    await untilAnswers(builderTags, BUILDER_TIMEOUT_MS, clock);
    const tags = new Set((await builderTags()).split("\n").filter(Boolean));
    const volume = `${install}-golden-${Math.floor(now() / 1000)}.qcow2`;

    log(`golden: stopping ${domain} to copy its disk`);
    await virsh(["shutdown", domain]);
    try {
      await untilAnswers(async () => {
        if ((await state()) !== "shut off") throw new Error(`${domain} didn't shut down`);
      }, BUILDER_TIMEOUT_MS, clock);
      await virsh(["vol-clone", "--pool", pool, `${domain}.qcow2`, volume]);
    } finally {
      // A builder left down would fail every later image build. Starting one that never stopped fails harmlessly.
      await virsh(["start", domain]).catch(() => {});
      await untilAnswers(builderTags, BUILDER_TIMEOUT_MS, clock).catch(() => log(`golden: ${domain} isn't answering after its copy`));
    }
    current = { volume, tags };
    log(`golden: new job VMs boot from ${volume}`);
    await prune();
  }

  // Deletes this install's golden copies that no job VM is using, including ones an earlier `up` left.
  async function prune() {
    const names = (await virsh(["vol-list", "--pool", pool])).split("\n").map((line) => line.trim().split(/\s+/)[0] ?? "");
    const golden = new RegExp(`^${install}-golden-\\d+\\.qcow2$`);
    for (const name of names) {
      if (!golden.test(name) || name === current?.volume || holds.has(name)) continue;
      await virsh(["vol-delete", "--pool", pool, name]).catch((error: unknown) => log(`golden: ${error instanceof Error ? error.message : error}`));
    }
  }

  // Returns a golden volume holding `tag`, copying the builder first when the current one doesn't.
  // An image built from a context exists only in the builder, so its tag has to be in the copy. Call
  // `release` when the job VM is gone, so the copy can be deleted once it's been replaced.
  async function hold(tag?: string) {
    if (lacks(tag)) {
      await inTurn(async () => {
        if (lacks(tag)) await publish();
      });
    }
    if (!current || lacks(tag)) throw new Error(`${tag} isn't in the builder, so no job VM can run it`);
    const { volume } = current;
    holds.set(volume, (holds.get(volume) ?? 0) + 1);
    return {
      volume,
      release: async () => {
        const left = (holds.get(volume) ?? 1) - 1;
        if (left > 0) return void holds.set(volume, left);
        holds.delete(volume);
        if (volume !== current?.volume) await prune().catch(() => {});
      },
    };
  }

  return { hold };
}

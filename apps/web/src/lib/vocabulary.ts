import type { Verdict } from "@runnerbox/contracts";

// What a failure's verdict means, in words someone new to CI reads without a glossary.
export const VERDICT_WORDS: Record<Verdict, string> = {
  infra: "the machine",
  code: "the code",
  flaky: "flaky",
  unconfirmed: "failed once",
};

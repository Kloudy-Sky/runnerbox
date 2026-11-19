import { useAtomValue } from "@effect/atom-react";
import type { ApplyWhen } from "@runnerbox/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { appAtomRegistry } from "../rpc/atomRegistry.ts";
import { runtime } from "../runtime.ts";
import { proposalsAtom } from "../state/inbox.ts";
import { useActiveEnvironment } from "./useEnvironment.ts";

// Every proposal on the active environment, and the owner's decisions on them. A decision answers
// with that one proposal, so the list is asked again after it.
export function useProposals() {
  const { environment } = useActiveEnvironment();
  const environmentId = environment?.environmentId ?? "";
  const list = Option.getOrUndefined(AsyncResult.value(useAtomValue(proposalsAtom(environmentId))));
  const refresh = () => appAtomRegistry.refresh(proposalsAtom(environmentId));
  return {
    proposals: list?.proposals ?? [],
    refresh,
    canApprove: list?.canApprove ?? false,
    approve: (id: string, hash: string, when: ApplyWhen) => runtime.run(environmentId, (client) => client["proposals.approve"]({ id, hash, when })).finally(refresh),
    decline: (id: string) => runtime.run(environmentId, (client) => client["proposals.decline"]({ id })).finally(refresh),
    revert: (id: string) => runtime.run(environmentId, (client) => client["proposals.revert"]({ id })).finally(refresh),
  };
}

import { useAtomValue } from "@effect/atom-react";
import { answerOf } from "../lib/answer.ts";
import { appAtomRegistry } from "../rpc/atomRegistry.ts";
import { accountsAtom } from "../state/providers.ts";
import { useActiveEnvironment } from "./useEnvironment.ts";

// The accounts agent turns can run as, and a way to ask again after a change.
export function useAccounts() {
  const environmentId = useActiveEnvironment().environment?.environmentId ?? "";
  const accounts = answerOf(useAtomValue(accountsAtom(environmentId)));
  return {
    accounts: accounts.data ?? [],
    loaded: accounts.isSuccess,
    error: accounts.error,
    refresh: () => appAtomRegistry.refresh(accountsAtom(environmentId)),
  };
}

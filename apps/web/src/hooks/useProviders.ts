import type { SaveProviderAccount } from "@runnerbox/contracts";
import { useAtomValue } from "@effect/atom-react";
import { answerOf } from "../lib/answer.ts";
import { providersFrom } from "../lib/providersFrom.ts";
import { appAtomRegistry } from "../rpc/atomRegistry.ts";
import { runtime } from "../runtime.ts";
import { accountsAtom, harnessesAtom, providersAtom } from "../state/providers.ts";
import { useActiveEnvironment } from "./useEnvironment.ts";
import { useServerCapabilities } from "./useServerCapabilities.ts";

// Each driver the server runs, with its models and accounts: from `providers.list` when the server
// has it, otherwise from `accounts.list` and `threads.harnesses`, which older servers answer.
export function useProviders() {
  const { environment } = useActiveEnvironment();
  const environmentId = environment?.environmentId ?? "";
  const capabilities = useServerCapabilities();
  // On a server with `providers.list`, the older two read no machine, which never asks.
  const older = capabilities.providers ? "" : environmentId;
  const current = answerOf(useAtomValue(providersAtom(environmentId)));
  const accounts = answerOf(useAtomValue(accountsAtom(older)));
  const harnesses = answerOf(useAtomValue(harnessesAtom(older)));
  const providers = capabilities.providers ? (current.data ?? []) : providersFrom(harnesses.data ?? [], accounts.data ?? []);
  const loaded = capabilities.providers ? current.isSuccess : accounts.isSuccess;
  // The composer and monitors read accounts too, so a change refreshes every list of them.
  const refresh = () => {
    appAtomRegistry.refresh(providersAtom(environmentId));
    appAtomRegistry.refresh(accountsAtom(environmentId));
    appAtomRegistry.refresh(harnessesAtom(environmentId));
  };
  // An older server runs Claude alone, and takes it as `accounts.save` names it.
  // Two runs, not one with a choice inside: each method answers its own account shape.
  const save = (input: SaveProviderAccount) =>
    capabilities.providers
      ? runtime.run(environmentId, (client) => client["providers.save"](input))
      : runtime.run(environmentId, (client) => client["accounts.save"]({ ...input, driver: "claude" }));
  return { providers, loaded, error: capabilities.providers ? current.error : accounts.error, refresh, save, environmentId };
}

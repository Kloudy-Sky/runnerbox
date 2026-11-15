import type { SaveProviderAccount } from "@runnerbox/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { providersFrom } from "../lib/providersFrom.ts";
import { runtime } from "../runtime.ts";
import { useActiveEnvironment } from "./useEnvironment.ts";
import { useRpcQuery } from "./useRpcQuery.ts";
import { useServerCapabilities } from "./useServerCapabilities.ts";

// Each driver the server runs, with its models and accounts: from `providers.list` when the server
// has it, otherwise from `accounts.list` and `threads.harnesses`, which older servers answer.
export function useProviders() {
  const { environment } = useActiveEnvironment();
  const environmentId = environment?.environmentId ?? "";
  const capabilities = useServerCapabilities();
  const queryClient = useQueryClient();
  const current = useRpcQuery(["providers"], (client) => client["providers.list"](), { enabled: capabilities.providers });
  const accounts = useRpcQuery(["accounts"], (client) => client["accounts.list"](), { enabled: !capabilities.providers });
  const harnesses = useRpcQuery(["threads.harnesses"], (client) => client["threads.harnesses"](), { enabled: !capabilities.providers && capabilities.models });
  const providers = capabilities.providers ? (current.data ?? []) : providersFrom(harnesses.data ?? [], accounts.data ?? []);
  const loaded = capabilities.providers ? current.isSuccess : accounts.isSuccess;
  // The composer and monitors read accounts too, so a change refreshes every list of them.
  const refresh = () => Promise.all(["providers", "accounts", "threads.harnesses"].map((key) => queryClient.invalidateQueries({ queryKey: [environmentId, key] })));
  // An older server runs Claude alone, and takes it as `accounts.save` names it.
  // Two runs, not one with a choice inside: each method answers its own account shape.
  const save = (input: SaveProviderAccount) =>
    capabilities.providers
      ? runtime.run(environmentId, (client) => client["providers.save"](input))
      : runtime.run(environmentId, (client) => client["accounts.save"]({ ...input, driver: "claude" }));
  return { providers, loaded, error: capabilities.providers ? current.error : accounts.error, refresh, save, environmentId };
}

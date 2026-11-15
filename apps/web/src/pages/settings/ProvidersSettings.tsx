import type { Provider } from "@runnerbox/contracts";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { type AccountActions, ProviderAccountEditor } from "../../components/settings/ProviderAccountEditor.tsx";
import { ProviderAccountRow } from "../../components/settings/ProviderAccountRow.tsx";
import { SettingsIntro } from "../../components/settings/SettingsIntro.tsx";
import { SettingsPageContainer, SettingsRow, SettingsSection, SettingsUnavailableGroup } from "../../components/settings/settingsLayout.tsx";
import { StatusDot } from "../../components/settings/StatusDot.tsx";
import { Button } from "../../components/ui/button.tsx";
import { toastManager } from "../../components/ui/toast.tsx";
import { useActiveEnvironment } from "../../hooks/useEnvironment.ts";
import { useProviders } from "../../hooks/useProviders.ts";
import { runtime } from "../../runtime.ts";

const errorText = (error: unknown) => (error instanceof Error ? error.message : "That didn't work.");
const READ_ONLY = "Adding or changing accounts needs a session that manages access. Pair again by address or over SSH for one.";

// What's open under a driver's section: one of its accounts, or a new one.
type Editing = { readonly driver: string; readonly accountId: string | null };

// After T3 Code's provider settings (MIT, see THIRD_PARTY_NOTICES.md): a section for each driver
// this server runs, with its status, its accounts and its models. Only drivers the server lists
// appear.
export function ProvidersSettings() {
  const { providers, refresh, save, environmentId } = useProviders();
  const { environment } = useActiveEnvironment();
  const canEdit = environment?.scopes.includes("access:write") ?? false;
  const [editing, setEditing] = useState<Editing | null>(null);
  const done = (message: string) => (result: Promise<unknown>) =>
    result.then(
      () => {
        toastManager.add({ title: message });
        return refresh();
      },
      (error: unknown) => {
        toastManager.add({ title: "That didn't work", description: errorText(error) });
        throw error;
      },
    );
  const actions: AccountActions = {
    save: (input) => done(input.id ? "Account saved" : "Account added")(save(input)),
    remove: (id) => done("Account removed")(runtime.run(environmentId, (client) => client["accounts.remove"]({ id }))),
    setDefault: (id) => done("Default account changed")(runtime.run(environmentId, (client) => client["accounts.setDefault"]({ id }))),
  };
  return (
    <SettingsPageContainer>
      <SettingsIntro>Who agent threads run as, for each provider this server runs. A key is kept on the runner machine, owner-only, and only its last four characters are ever shown again.</SettingsIntro>
      {providers.map((provider) => (
        <ProviderSection key={provider.driver} provider={provider} canEdit={canEdit} editing={editing?.driver === provider.driver ? editing : null} onEdit={setEditing} actions={actions} />
      ))}
    </SettingsPageContainer>
  );
}

function ProviderSection({
  provider,
  canEdit,
  editing,
  onEdit,
  actions,
}: {
  provider: Provider;
  canEdit: boolean;
  editing: Editing | null;
  onEdit: (editing: Editing | null) => void;
  actions: AccountActions;
}) {
  const open = editing === null ? undefined : editing.accountId === null ? null : provider.accounts.find((account) => account.id === editing.accountId);
  const rows = (
    <>
      <SettingsRow
        title="Status"
        status={
          <span className="flex items-center gap-1.5">
            <StatusDot available={provider.status.available} />
            {provider.status.available ? "Ready" : (provider.status.fix ?? "Not ready")}
          </span>
        }
      />
      {provider.accounts.map((account) => (
        <ProviderAccountRow
          key={account.id}
          account={account}
          selected={editing?.accountId === account.id}
          onSelect={canEdit ? () => onEdit(editing?.accountId === account.id ? null : { driver: provider.driver, accountId: account.id }) : undefined}
        />
      ))}
    </>
  );
  return (
    <>
      <SettingsSection
        title={provider.label}
        headerAction={
          canEdit ? (
            <Button size="sm" variant="outline" disabled={editing !== null} onClick={() => onEdit({ driver: provider.driver, accountId: null })}>
              <PlusIcon className="size-3.5" /> Add account
            </Button>
          ) : null
        }
      >
        {canEdit ? rows : <SettingsUnavailableGroup message={READ_ONLY}>{rows}</SettingsUnavailableGroup>}
      </SettingsSection>
      {canEdit && open !== undefined ? <ProviderAccountEditor key={editing?.accountId ?? "new"} provider={provider} account={open} actions={actions} onDone={() => onEdit(null)} /> : null}
      {provider.models.length > 0 ? (
        <SettingsSection title={`${provider.label} models`}>
          {provider.models.map((model) => (
            <SettingsRow key={model.id} title={model.label} control={<code className="text-xs text-muted-foreground">{model.id}</code>} />
          ))}
        </SettingsSection>
      ) : null}
    </>
  );
}

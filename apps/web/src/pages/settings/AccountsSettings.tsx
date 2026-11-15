import { type Account, BUILT_IN_ACCOUNT_ID } from "@runnerbox/contracts";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { SettingsIntro } from "../../components/settings/SettingsIntro.tsx";
import { SettingsPageContainer, SettingsRow, SettingsSection, SettingsUnavailableGroup } from "../../components/settings/settingsLayout.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../components/ui/select.tsx";
import { toastManager } from "../../components/ui/toast.tsx";
import { useAccounts } from "../../hooks/useAccounts.ts";
import { useActiveEnvironment } from "../../hooks/useEnvironment.ts";
import { cn } from "../../lib/utils.ts";
import { runtime } from "../../runtime.ts";

const errorText = (error: unknown) => (error instanceof Error ? error.message : "That didn't work.");

export const billingWords = (account: Account) => (account.billing === "api_key" ? `Key ending ${account.keyLast4}` : "Login on this machine");
export const statusWords = (account: Account) => (!account.status.available ? "Not ready" : account.billing === "api_key" ? "Key set" : "Signed in");

// After T3 Code's providers panel: the accounts threads run as, each a driver, a label, an optional
// model, and for an API account a key the server keeps and never sends back.
export function AccountsSettings() {
  const { accounts, refresh } = useAccounts();
  const { environment } = useActiveEnvironment();
  const canEdit = environment?.scopes.includes("access:write") ?? false;
  // The account being edited, or "new" for one being added.
  const [editing, setEditing] = useState<string | null>(null);
  const selected = editing === "new" ? null : accounts.find((account) => account.id === editing);
  const rows = accounts.map((account) => (
    <SettingsRow
      key={account.id}
      className={cn(account.id === editing && "bg-accent/40")}
      title={
        <>
          {account.label}
          {account.isDefault ? <span className="font-normal text-muted-foreground"> default</span> : null}
        </>
      }
      description={`${account.driver === "claude" ? "Claude" : account.driver}, ${billingWords(account).toLowerCase()}, model ${account.model ?? "default"}`}
      status={account.id === editing && !account.status.available && account.status.fix ? account.status.fix : undefined}
      control={
        <>
          <span className="inline-flex items-center gap-1.5 text-muted-foreground text-xs">
            <span className={cn("size-1.5 rounded-full", account.status.available ? "bg-success" : "bg-destructive")} />
            {statusWords(account)}
          </span>
          <Button size="xs" variant={account.id === editing ? "secondary" : "ghost-muted"} onClick={() => setEditing(account.id === editing ? null : account.id)}>
            {canEdit ? "Edit" : "Details"}
          </Button>
        </>
      }
    />
  ));
  return (
    <SettingsPageContainer>
      <SettingsIntro>
        Who agent threads run as. A key is kept on the runner machine, owner-only. You can set or replace it here, but it's never shown again, only its last four characters. A key in the server's own environment is never used.
      </SettingsIntro>
      <SettingsSection
        title="Accounts"
        headerAction={
          canEdit ? (
            <Button size="sm" variant="outline" disabled={editing !== null} onClick={() => setEditing("new")}>
              <PlusIcon className="size-3.5" /> Add account
            </Button>
          ) : null
        }
      >
        {canEdit ? rows : <SettingsUnavailableGroup message="Adding or changing accounts needs a session that manages access. Pair again by address or over SSH for one.">{rows}</SettingsUnavailableGroup>}
      </SettingsSection>
      {canEdit && editing !== null ? <AccountEditor key={editing} account={selected ?? null} onDone={(next) => void refresh().then(() => setEditing(next))} /> : null}
    </SettingsPageContainer>
  );
}

function AccountEditor({ account, onDone }: { account: Account | null; onDone: (id: string | null) => void }) {
  const { environment } = useActiveEnvironment();
  const environmentId = environment?.environmentId ?? "";
  const builtIn = account?.id === BUILT_IN_ACCOUNT_ID;
  const [label, setLabel] = useState(account?.label ?? "Claude, API");
  const [model, setModel] = useState(account?.model ?? "");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const act = async (work: () => Promise<unknown>, next: string | null, message: string) => {
    setBusy(true);
    await work().then(
      () => {
        toastManager.add({ title: message });
        onDone(next);
      },
      (error: unknown) => toastManager.add({ title: "That didn't work", description: errorText(error) }),
    );
    setBusy(false);
  };
  const save = () =>
    act(
      () =>
        runtime.run(environmentId, (client) =>
          client["accounts.save"]({
            ...(account ? { id: account.id } : {}),
            driver: "claude",
            label: label.trim(),
            model: model.trim() === "" ? null : model.trim(),
            ...(apiKey.trim() === "" ? {} : { apiKey: apiKey.trim() }),
          }),
        ),
      null,
      account ? "Account saved" : "Account added",
    );
  return (
    <SettingsSection title={account ? account.label : "New account"} className="enter">
      <SettingsRow title="Label" control={<Input value={label} onValueChange={setLabel} disabled={builtIn} className="w-64" />} />
      <SettingsRow
        title="Driver"
        description="Codex comes later."
        control={
          <Select value="claude" disabled>
            <SelectTrigger className="w-64">
              <SelectValue>{() => "Claude"}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="claude">Claude</SelectItem>
            </SelectPopup>
          </Select>
        }
      />
      {builtIn ? null : (
        <SettingsRow
          title="API key"
          description={account?.keyLast4 ? "Leave empty to keep the key it has." : "Leave empty to use the Claude login on the runner machine."}
          control={<Input type="password" autoComplete="off" value={apiKey} onValueChange={setApiKey} placeholder={account?.keyLast4 ? `••••••••${account.keyLast4}` : "sk-ant-…"} className="w-64" font="mono" />}
        />
      )}
      <SettingsRow title="Model" description="A model name or alias, such as haiku. Empty uses Claude Code's default." control={<Input value={model} onValueChange={setModel} placeholder="default" className="w-64" />} />
      <div className="flex justify-end gap-2 px-3 py-3 sm:px-4">
        <Button variant="ghost-muted" size="sm" disabled={busy} onClick={() => onDone(null)}>
          Cancel
        </Button>
        {account && !builtIn ? (
          <Button variant="destructive-outline" size="sm" disabled={busy} onClick={() => void act(() => runtime.run(environmentId, (client) => client["accounts.remove"]({ id: account.id })), null, "Account removed")}>
            Remove
          </Button>
        ) : null}
        {account && !account.isDefault ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void act(() => runtime.run(environmentId, (client) => client["accounts.setDefault"]({ id: account.id })), account.id, "Default account changed")}>
            Make default
          </Button>
        ) : null}
        <Button size="sm" disabled={busy || label.trim() === ""} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </SettingsSection>
  );
}

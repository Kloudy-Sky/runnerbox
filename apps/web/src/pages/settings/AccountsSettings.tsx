import { type Account, BUILT_IN_ACCOUNT_ID } from "@runnerbox/contracts";
import { useState } from "react";
import { SettingsPanel } from "../../components/settings/SettingsPanel.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../components/ui/select.tsx";
import { toast } from "../../components/ui/toast.tsx";
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
  return (
    <SettingsPanel.Root>
      <SettingsPanel.Header
        title="Accounts"
        description="Who agent threads run as. A key is kept on the runner machine, owner-only. You can set or replace it here, but it's never shown again, only its last four characters. A key in the server's own environment is never used."
      />
      <SettingsPanel.Group>
        {accounts.map((account) => (
          <button
            key={account.id}
            type="button"
            onClick={() => setEditing(account.id === editing ? null : account.id)}
            className={cn("enter -mx-2.5 flex cursor-pointer items-center gap-4 rounded-[var(--control-radius)] px-2.5 py-2 text-left transition-colors hover:bg-accent", account.id === editing && "bg-accent")}
          >
            <span className="min-w-0 flex-1">
              <span className="block">
                {account.label}
                {account.isDefault ? <span className="text-muted-foreground"> default</span> : null}
              </span>
              <span className="block text-muted-foreground text-[13px]">
                {account.driver === "claude" ? "Claude" : account.driver}, {billingWords(account).toLowerCase()}, model {account.model ?? "default"}
              </span>
            </span>
            <span className="inline-flex items-center gap-1.5 text-muted-foreground text-[13px]">
              <span className={cn("size-1.5 rounded-full", account.status.available ? "bg-success" : "bg-destructive")} />
              {statusWords(account)}
            </span>
          </button>
        ))}
      </SettingsPanel.Group>
      {canEdit ? (
        editing === null ? (
          <div>
            <Button variant="secondary" onClick={() => setEditing("new")}>
              Add account
            </Button>
          </div>
        ) : (
          <AccountEditor key={editing} account={selected ?? null} onDone={(next) => void refresh().then(() => setEditing(next))} />
        )
      ) : (
        <SettingsPanel.Notice>Adding or changing accounts needs a session that manages access. Pair again by address or over SSH for one.</SettingsPanel.Notice>
      )}
      {selected && !selected.status.available && selected.status.fix ? <SettingsPanel.Notice>{selected.status.fix}</SettingsPanel.Notice> : null}
    </SettingsPanel.Root>
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
        toast.add({ title: message });
        onDone(next);
      },
      (error: unknown) => toast.add({ title: "That didn't work", description: errorText(error) }),
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
    <SettingsPanel.Group title={account ? account.label : "New account"} className="enter">
      <SettingsPanel.Row label="Label">
        <Input value={label} onValueChange={setLabel} disabled={builtIn} className="w-64" />
      </SettingsPanel.Row>
      <SettingsPanel.Row label="Driver" description="Codex comes later.">
        <Select value="claude" disabled>
          <SelectTrigger className="w-64">
            <SelectValue>{() => "Claude"}</SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="claude">Claude</SelectItem>
          </SelectPopup>
        </Select>
      </SettingsPanel.Row>
      {builtIn ? null : (
        <SettingsPanel.Row label="API key" description={account?.keyLast4 ? "Leave empty to keep the key it has." : "Leave empty to use the Claude login on the runner machine."}>
          <Input type="password" autoComplete="off" value={apiKey} onValueChange={setApiKey} placeholder={account?.keyLast4 ? `••••••••${account.keyLast4}` : "sk-ant-…"} className="w-64" font="mono" />
        </SettingsPanel.Row>
      )}
      <SettingsPanel.Row label="Model" description="A model name or alias, such as haiku. Empty uses Claude Code's default.">
        <Input value={model} onValueChange={setModel} placeholder="default" className="w-64" />
      </SettingsPanel.Row>
      <div className="flex gap-2 pt-2">
        <Button disabled={busy || label.trim() === ""} onClick={() => void save()}>
          Save
        </Button>
        {account && !account.isDefault ? (
          <Button variant="secondary" disabled={busy} onClick={() => void act(() => runtime.run(environmentId, (client) => client["accounts.setDefault"]({ id: account.id })), account.id, "Default account changed")}>
            Make default
          </Button>
        ) : null}
        {account && !builtIn ? (
          <Button variant="destructive" disabled={busy} onClick={() => void act(() => runtime.run(environmentId, (client) => client["accounts.remove"]({ id: account.id })), null, "Account removed")}>
            Remove
          </Button>
        ) : null}
        <Button variant="ghost-muted" disabled={busy} onClick={() => onDone(null)}>
          Cancel
        </Button>
      </div>
    </SettingsPanel.Group>
  );
}

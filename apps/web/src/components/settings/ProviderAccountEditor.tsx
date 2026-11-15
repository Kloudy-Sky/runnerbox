import { type Provider, type ProviderAccount, type SaveProviderAccount, BUILT_IN_ACCOUNT_ID } from "@runnerbox/contracts";
import { Trash2Icon } from "lucide-react";
import { useState } from "react";
import { billingWords, statusWords } from "../../lib/accountWords.ts";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select.tsx";
import { SettingsRow, SettingsSection } from "./settingsLayout.tsx";
import { StatusDot } from "./StatusDot.tsx";

// No model: the turn runs on the harness's own default.
const DEFAULT_MODEL = "";

export type AccountActions = {
  readonly save: (input: SaveProviderAccount) => Promise<unknown>;
  readonly remove: (id: string) => Promise<unknown>;
  readonly setDefault: (id: string) => Promise<unknown>;
};

// One account opened for editing, or a new one, as T3 Code's provider instance card opens in
// editor mode (MIT, see THIRD_PARTY_NOTICES.md): its status first, then its fields, and deleting
// from the header. A key is write-only: the field starts empty, and empty keeps the key it has.
export function ProviderAccountEditor({
  provider,
  account,
  actions,
  onDone,
}: {
  provider: Provider;
  account: ProviderAccount | null;
  actions: AccountActions;
  onDone: () => void;
}) {
  const builtIn = account?.id === BUILT_IN_ACCOUNT_ID;
  const [label, setLabel] = useState(account?.label ?? `${provider.label}, API`);
  const [model, setModel] = useState(account?.model ?? DEFAULT_MODEL);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const act = (work: () => Promise<unknown>) => {
    setBusy(true);
    void work().then(onDone, () => setBusy(false));
  };
  // A model saved before the picker, that the server doesn't offer, stays visible rather than silently going.
  const models = account?.model && !provider.models.some((each) => each.id === account.model) ? [...provider.models, { id: account.model, label: `${account.model} (not offered)` }] : provider.models;
  const modelLabel = (id: string) => (id === DEFAULT_MODEL ? `${provider.label} default` : (models.find((each) => each.id === id)?.label ?? id));
  const save = () =>
    act(() =>
      actions.save({
        ...(account ? { id: account.id } : {}),
        driver: provider.driver,
        label: label.trim(),
        model: model === DEFAULT_MODEL ? null : model,
        ...(apiKey.trim() === "" ? {} : { apiKey: apiKey.trim() }),
      }),
    );
  return (
    <SettingsSection
      title={account?.label ?? `New ${provider.label} account`}
      className="enter"
      headerAction={
        account && !builtIn ? (
          <Button type="button" size="icon-xs" variant="ghost-destructive" disabled={busy} onClick={() => act(() => actions.remove(account.id))} aria-label={`Remove ${account.label}`}>
            <Trash2Icon />
          </Button>
        ) : null
      }
    >
      {account ? (
        <SettingsRow
          title="Status"
          status={
            <span className="flex items-center gap-1.5">
              <StatusDot available={account.status.available} />
              {statusWords(account)} · {billingWords(account)}
              {!account.status.available && account.status.fix ? ` · ${account.status.fix}` : null}
            </span>
          }
        />
      ) : null}
      <SettingsRow title="Label" control={<Input value={label} onValueChange={setLabel} disabled={builtIn} className="w-64" size="sm" />} />
      {builtIn ? null : (
        <SettingsRow
          title="API key"
          description={`Kept on the runner machine, owner-only, and never shown again: only its last four characters. ${account?.keyLast4 ? "Leave empty to keep the key it has." : `Leave empty to use the ${provider.label} login on the runner machine.`} A key in the server's own environment is never used.`}
          control={
            <Input
              type="password"
              autoComplete="off"
              value={apiKey}
              onValueChange={setApiKey}
              placeholder={account?.keyLast4 ? `••••••••${account.keyLast4}` : "Paste a key"}
              className="w-64"
              size="sm"
              font="mono"
            />
          }
        />
      )}
      <SettingsRow
        title="Model"
        description="What this account's turns run on, unless the composer picks another."
        control={
          <Select value={model} onValueChange={(value) => setModel(value ?? DEFAULT_MODEL)}>
            <SelectTrigger className="w-64" size="sm">
              <SelectValue>{() => modelLabel(model)}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value={DEFAULT_MODEL}>{modelLabel(DEFAULT_MODEL)}</SelectItem>
              {models.map((each) => (
                <SelectItem key={each.id} value={each.id}>
                  {each.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      <div className="flex justify-end gap-2 px-3 py-3 sm:px-4">
        <Button variant="ghost-muted" size="sm" disabled={busy} onClick={onDone}>
          Cancel
        </Button>
        {account && !account.isDefault ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => act(() => actions.setDefault(account.id))}>
            Make default
          </Button>
        ) : null}
        <Button size="sm" disabled={busy || label.trim() === ""} onClick={save}>
          Save
        </Button>
      </div>
    </SettingsSection>
  );
}

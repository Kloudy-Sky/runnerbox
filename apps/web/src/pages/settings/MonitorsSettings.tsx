import { DEFAULT_MONITOR_MODEL, MAX_DAILY_LIMIT, type MonitorSettings, type MonitorStatus } from "@runnerbox/contracts";
import { Link } from "@tanstack/react-router";
import { Minus, Plus } from "lucide-react";
import { useState } from "react";
import { SettingsPanel } from "../../components/settings/SettingsPanel.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../components/ui/select.tsx";
import { Switch } from "../../components/ui/switch.tsx";
import { useAccounts } from "../../hooks/useAccounts.ts";
import { useMonitors } from "../../hooks/useMonitors.ts";
import { formatAge } from "../../lib/format.ts";
import type { RootSearch } from "../../lib/search.ts";

const DEFAULT_ACCOUNT = "default";

const cost = (usd: number) => (usd > 0 && usd < 0.01 ? "under $0.01" : `about $${usd.toFixed(2)}`);
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const OUTCOME = { running: "looking now", completed: "done", failed: "failed", interrupted: "stopped" } as const;

// Where today stands: looks used out of the limit, what they cost, and what the limit skipped.
function todayWords(status: MonitorStatus) {
  const { looks, costUsd, skipped } = status.today;
  const used = `${looks} of ${status.settings.dailyLimit} today, ${cost(costUsd)}.`;
  return skipped > 0 ? `${used} The limit was reached, so ${plural(skipped, "new item was", "new items were")} skipped until tomorrow.` : used;
}

// Monitors: the agent looking into each new problem on its own. What a look spends, and the limit
// on how many a day, sit together, so the owner sets the limit where they read what it means.
export function MonitorsSettings() {
  const { status, save } = useMonitors();
  const { accounts } = useAccounts();
  const [error, setError] = useState<string | null>(null);
  if (!status) return null;
  const { settings, canConfigure } = status;
  const change = (next: Partial<MonitorSettings>) => {
    setError(null);
    save({ ...settings, ...next }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "That didn't work."));
  };
  const account = accounts.find((each) => (settings.accountId === null ? each.isDefault : each.id === settings.accountId));
  return (
    <SettingsPanel.Root>
      <SettingsPanel.Header title="Monitors" description="When something new needs you, the agent looks into it on its own and leaves what it found in that item's thread. It only reads." />
      <SettingsPanel.Group>
        <SettingsPanel.Row label="Look into new items automatically" description={canConfigure ? undefined : "This device can't change monitors."}>
          <Switch checked={settings.enabled} disabled={!canConfigure} onCheckedChange={(enabled) => change({ enabled })} />
        </SettingsPanel.Row>
        <SettingsPanel.Row label="Automatic looks per day" description="Each look uses the account below: its subscription, or money on an API key. Threads you start yourself are never counted or held back.">
          <Button size="icon-sm" variant="ghost-muted" aria-label="Fewer" disabled={!canConfigure || settings.dailyLimit <= 1} onClick={() => change({ dailyLimit: settings.dailyLimit - 1 })}>
            <Minus />
          </Button>
          <span className="w-6 text-center tabular-nums">{settings.dailyLimit}</span>
          <Button size="icon-sm" variant="ghost-muted" aria-label="More" disabled={!canConfigure || settings.dailyLimit >= MAX_DAILY_LIMIT} onClick={() => change({ dailyLimit: settings.dailyLimit + 1 })}>
            <Plus />
          </Button>
        </SettingsPanel.Row>
        {settings.enabled || status.runs.length > 0 ? <SettingsPanel.Row label="Today" description={todayWords(status)} /> : null}
        <SettingsPanel.Row label="Account">
          <Select value={settings.accountId ?? DEFAULT_ACCOUNT} disabled={!canConfigure} onValueChange={(value) => value && change({ accountId: value === DEFAULT_ACCOUNT ? null : value })}>
            <SelectTrigger className="w-56">
              <SelectValue>{() => (settings.accountId === null ? `Default (${account?.label ?? "Claude"})` : (account?.label ?? settings.accountId))}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value={DEFAULT_ACCOUNT}>Default ({accounts.find((each) => each.isDefault)?.label ?? "Claude"})</SelectItem>
              {accounts.map((each) => (
                <SelectItem key={each.id} value={each.id}>
                  {each.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </SettingsPanel.Row>
        <SettingsPanel.Row label="Model" description="Haiku unless you name another.">
          <Input
            key={settings.model ?? ""}
            className="w-56"
            size="sm"
            defaultValue={settings.model ?? ""}
            placeholder={DEFAULT_MONITOR_MODEL}
            disabled={!canConfigure}
            onBlur={(event) => {
              const model = event.target.value.trim() || null;
              if (model !== settings.model) change({ model });
            }}
          />
        </SettingsPanel.Row>
        {error ? <SettingsPanel.Notice className="text-destructive">{error}</SettingsPanel.Notice> : null}
      </SettingsPanel.Group>
      {status.runs.length > 0 ? (
        <SettingsPanel.Group title="Recent looks">
          {status.runs.map((run) => (
            <SettingsPanel.Row
              key={`${run.threadId}${run.startedAt}`}
              label={
                <Link to="/item/$itemId" params={{ itemId: run.itemId }} search={(previous: RootSearch) => previous} className="hover:underline">
                  {run.title}
                </Link>
              }
              description={`${formatAge(run.startedAt)} ago, ${run.why === undefined ? OUTCOME[run.outcome] : `couldn't start: ${run.why}`}${run.costUsd === null ? "" : `, ${cost(run.costUsd)}`}`}
            />
          ))}
        </SettingsPanel.Group>
      ) : null}
    </SettingsPanel.Root>
  );
}

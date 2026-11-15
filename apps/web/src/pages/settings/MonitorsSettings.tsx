import { DEFAULT_DAILY_LIMIT, DEFAULT_MONITOR_MODEL, MAX_DAILY_LIMIT, type MonitorSettings, type MonitorStatus } from "@runnerbox/contracts";
import { Link } from "@tanstack/react-router";
import { Minus, Plus } from "lucide-react";
import { useState } from "react";
import { SettingsIntro } from "../../components/settings/SettingsIntro.tsx";
import { SettingResetButton, SettingsPageContainer, SettingsRow, SettingsSection } from "../../components/settings/settingsLayout.tsx";
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

// Monitors: the agent looking into each new problem on its own. What a look spends, where today
// stands, and the limit on how many a day sit in one row, so the owner sets the limit where they
// read what it means.
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
    <SettingsPageContainer>
      <SettingsIntro>When something new needs you, the agent looks into it on its own and leaves what it found in that item's thread. It only reads.</SettingsIntro>
      <SettingsSection title="Monitors">
        <SettingsRow
          title="Look into new items automatically"
          description={canConfigure ? undefined : "This device can't change monitors."}
          control={<Switch checked={settings.enabled} disabled={!canConfigure} onCheckedChange={(enabled) => change({ enabled })} aria-label="Look into new items automatically" />}
        />
        <SettingsRow
          title="Automatic looks per day"
          description="Each look uses the account below: its subscription, or money on an API key. Threads you start yourself are never counted or held back."
          status={settings.enabled || status.runs.length > 0 ? <span className={status.today.skipped > 0 ? "text-warning" : undefined}>{todayWords(status)}</span> : undefined}
          resetAction={canConfigure && settings.dailyLimit !== DEFAULT_DAILY_LIMIT ? <SettingResetButton label="looks per day" onClick={() => change({ dailyLimit: DEFAULT_DAILY_LIMIT })} /> : null}
          control={
            <>
              <Button size="icon-sm" variant="ghost-muted" aria-label="Fewer" disabled={!canConfigure || settings.dailyLimit <= 1} onClick={() => change({ dailyLimit: settings.dailyLimit - 1 })}>
                <Minus />
              </Button>
              <span className="w-6 text-center tabular-nums">{settings.dailyLimit}</span>
              <Button size="icon-sm" variant="ghost-muted" aria-label="More" disabled={!canConfigure || settings.dailyLimit >= MAX_DAILY_LIMIT} onClick={() => change({ dailyLimit: settings.dailyLimit + 1 })}>
                <Plus />
              </Button>
            </>
          }
        />
        <SettingsRow
          title="Account"
          control={
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
          }
        />
        <SettingsRow
          title="Model"
          description="Haiku unless you name another."
          resetAction={canConfigure && settings.model !== null ? <SettingResetButton label="model" onClick={() => change({ model: null })} /> : null}
          control={
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
          }
        />
        {error ? <p className="px-3 py-3 text-destructive text-xs sm:px-4">{error}</p> : null}
      </SettingsSection>
      {status.runs.length > 0 ? (
        <SettingsSection title="Recent looks">
          {status.runs.map((run) => (
            <SettingsRow
              key={`${run.threadId}${run.startedAt}`}
              title={
                <Link to="/item/$itemId" params={{ itemId: run.itemId }} search={(previous: RootSearch) => previous} className="hover:underline">
                  {run.title}
                </Link>
              }
              description={`${formatAge(run.startedAt)} ago, ${run.why === undefined ? OUTCOME[run.outcome] : `couldn't start: ${run.why}`}${run.costUsd === null ? "" : `, ${cost(run.costUsd)}`}`}
            />
          ))}
        </SettingsSection>
      ) : null}
    </SettingsPageContainer>
  );
}

import { useState } from "react";
import { SettingsIntro } from "../../components/settings/SettingsIntro.tsx";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "../../components/settings/settingsLayout.tsx";
import { Switch } from "../../components/ui/switch.tsx";
import { useNotificationsSetting } from "../../hooks/useNeedsYouNotifications.ts";

const BLOCKED = "Notifications are blocked for this app. Allow them in your system settings, then turn this on again.";

// One switch, for this device only. The system asks for permission when it's turned on, never before.
export function NotificationsSettings() {
  const { enabled, setEnabled } = useNotificationsSetting();
  const [error, setError] = useState<string | null>(null);
  const supported = typeof Notification !== "undefined";
  const blocked = supported && enabled && Notification.permission === "denied";
  const turn = async (next: boolean) => {
    setError(null);
    if (!next) return setEnabled(false);
    const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    if (permission !== "granted") return setError(BLOCKED);
    setEnabled(true);
  };
  return (
    <SettingsPageContainer>
      <SettingsIntro>A notification from this computer when something new needs you, so CI can run in the background until then.</SettingsIntro>
      <SettingsSection title="Notifications">
        <SettingsRow
          title="Tell me when something needs me"
          description={supported ? "Once for each new item in Needs you. Clicking it opens the item. Failures in a job's own code aren't announced." : "This window can't show notifications."}
          status={error || blocked ? <span className="text-warning">{error ?? BLOCKED}</span> : undefined}
          control={<Switch checked={enabled && !blocked} disabled={!supported} onCheckedChange={(next) => void turn(next)} aria-label="Tell me when something needs me" />}
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

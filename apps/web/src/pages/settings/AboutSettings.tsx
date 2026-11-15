import { PROTOCOL_VERSION } from "@runnerbox/contracts";
import packageJson from "../../../package.json" with { type: "json" };
import { ServerUpdateCommand } from "../../components/ServerUpdateCommand.tsx";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "../../components/settings/settingsLayout.tsx";
import { UpdatesGroup } from "../../components/settings/UpdatesGroup.tsx";
import { useDesktopUpdates } from "../../hooks/useDesktopUpdates.ts";
import { useActiveEnvironment } from "../../hooks/useEnvironment.ts";
import { useRpcQuery } from "../../hooks/useRpcQuery.ts";
import { serverIsBehind } from "../../lib/serverUpdate.ts";
import { cn } from "../../lib/utils.ts";

// The libraries the app is built on, and their licences. The server's own are in its release.
const LICENCES = [
  ["runnerbox", "MIT"],
  ["T3 Code, whose components, layout and settings this app follows (see THIRD_PARTY_NOTICES.md)", "MIT"],
  ["React", "MIT"],
  ["Base UI", "MIT"],
  ["TanStack Query and Router", "MIT"],
  ["Effect", "MIT"],
  ["Zustand", "MIT"],
  ["Tailwind CSS", "MIT"],
  ["tailwind-merge", "MIT"],
  ["class-variance-authority", "Apache-2.0"],
  ["Lucide icons", "ISC"],
] as const;

// After T3 Code's about panel: which versions are talking, what "incompatible" means, and licences.
export function AboutSettings() {
  const { environment, connection } = useActiveEnvironment();
  const about = useRpcQuery(["about"], (client) => client["server.about"]());
  const incompatible = connection?.status === "disconnected" && connection.reason === "incompatible";
  const updates = useDesktopUpdates();
  const appVersion = packageJson.version;
  const behind = about.data !== undefined && serverIsBehind(appVersion, about.data.serverVersion);
  return (
    <SettingsPageContainer>
      <SettingsSection title="Versions">
        <SettingsRow title="This app" description={`Speaks protocol ${PROTOCOL_VERSION}.`} control={<span className="font-mono text-xs">{appVersion}</span>} />
        <SettingsRow
          title={`Server on ${environment?.label ?? "no environment"}`}
          description={
            behind
              ? "Older than this app. Update it on that machine with the command below."
              : about.data
                ? `Speaks protocol ${about.data.protocolVersion}.`
                : incompatible
                  ? "It speaks a protocol this app doesn't."
                  : "Not reached yet."
          }
          control={<span className="font-mono text-xs">{about.data?.serverVersion ?? "-"}</span>}
        >
          {behind || (incompatible && appVersion !== "0.0.0") ? (
            <div className="pt-2 pb-2">
              <ServerUpdateCommand appVersion={appVersion} />
            </div>
          ) : null}
        </SettingsRow>
      </SettingsSection>
      {updates ? <UpdatesGroup updates={updates} /> : null}
      <SettingsSection title="When a server is incompatible">
        <p className={cn("px-3 py-3 text-xs leading-normal sm:px-4", incompatible ? "text-foreground" : "text-muted-foreground")}>
          The app and the server agree on a protocol version. When they differ, the app won't send a credential to the server or read from it, and says the server is incompatible. Update
          whichever is older: the app, or <code className="font-mono">runnerbox.js</code> on the server's machine, then reconnect.
        </p>
      </SettingsSection>
      <SettingsSection title="Open-source licences">
        {LICENCES.map(([name, licence]) => (
          <SettingsRow key={name} title={<span className="font-normal">{name}</span>} className="py-2" control={<span className="text-muted-foreground text-xs">{licence}</span>} />
        ))}
      </SettingsSection>
    </SettingsPageContainer>
  );
}

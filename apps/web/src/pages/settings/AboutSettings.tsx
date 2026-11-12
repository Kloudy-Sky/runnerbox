import { PROTOCOL_VERSION } from "@runnerbox/contracts";
import packageJson from "../../../package.json" with { type: "json" };
import { ServerUpdateCommand } from "../../components/ServerUpdateCommand.tsx";
import { SettingsPanel } from "../../components/settings/SettingsPanel.tsx";
import { UpdatesGroup } from "../../components/settings/UpdatesGroup.tsx";
import { useDesktopUpdates } from "../../hooks/useDesktopUpdates.ts";
import { useActiveEnvironment } from "../../hooks/useEnvironment.ts";
import { useRpcQuery } from "../../hooks/useRpcQuery.ts";
import { serverIsBehind } from "../../lib/serverUpdate.ts";

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
    <SettingsPanel.Root>
      <SettingsPanel.Header title="About" />
      <SettingsPanel.Group>
        <SettingsPanel.Row label="This app" description={`Speaks protocol ${PROTOCOL_VERSION}.`}>
          <span className="font-mono text-[13px]">{appVersion}</span>
        </SettingsPanel.Row>
        <SettingsPanel.Row
          label={`Server on ${environment?.label ?? "no environment"}`}
          description={
            behind
              ? "Older than this app. Update it on that machine with the command below."
              : about.data
                ? `Speaks protocol ${about.data.protocolVersion}.`
                : incompatible
                  ? "It speaks a protocol this app doesn't."
                  : "Not reached yet."
          }
        >
          <span className="font-mono text-[13px]">{about.data?.serverVersion ?? "-"}</span>
        </SettingsPanel.Row>
        {behind || (incompatible && appVersion !== "0.0.0") ? <ServerUpdateCommand appVersion={appVersion} /> : null}
      </SettingsPanel.Group>
      {updates ? <UpdatesGroup updates={updates} /> : null}
      <SettingsPanel.Group title="When a server is incompatible">
        <p className={incompatible ? "text-foreground" : "text-muted-foreground"}>
          The app and the server agree on a protocol version. When they differ, the app won't send a credential to the server or read from it, and says the server is incompatible. Update
          whichever is older: the app, or <code className="font-mono">runnerbox.js</code> on the server's machine, then reconnect.
        </p>
      </SettingsPanel.Group>
      <SettingsPanel.Group title="Open-source licences">
        {LICENCES.map(([name, licence]) => (
          <SettingsPanel.Row key={name} label={name} className="min-h-8 py-0.5">
            <span className="text-muted-foreground text-[13px]">{licence}</span>
          </SettingsPanel.Row>
        ))}
      </SettingsPanel.Group>
    </SettingsPanel.Root>
  );
}

import { ALL_SCOPES, type AuthScope, type PairingCode } from "@runnerbox/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { SettingsPanel } from "../../components/settings/SettingsPanel.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Switch } from "../../components/ui/switch.tsx";
import { toast } from "../../components/ui/toast.tsx";
import { useActiveEnvironment } from "../../hooks/useEnvironment.ts";
import { useRpcQuery } from "../../hooks/useRpcQuery.ts";
import { formatAge } from "../../lib/format.ts";
import { SCOPE_WORDS } from "../../lib/vocabulary.ts";
import { runtime } from "../../runtime.ts";

const scopesInWords = (scopes: ReadonlyArray<AuthScope>) => {
  const words = scopes.map((scope) => SCOPE_WORDS[scope]);
  const sentence = words.length <= 1 ? (words[0] ?? "nothing") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
};

// After T3 Code's authorized clients panel: every device and agent that can reach this
// environment, what each may do, and a new pairing code with exactly the access you pick.
export function AccessSettings() {
  const { environment } = useActiveEnvironment();
  const environmentId = environment?.environmentId ?? "";
  const canManage = environment?.scopes.includes("access:write") ?? false;
  const queryClient = useQueryClient();
  const sessions = useRpcQuery(["sessions"], (client) => client["access.sessions"]());
  const [scopes, setScopes] = useState<ReadonlySet<AuthScope>>(new Set<AuthScope>(["history:read", "runners:read"]));
  const [code, setCode] = useState<PairingCode | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: [environmentId, "sessions"] });
  if (!canManage) {
    return (
      <SettingsPanel.Root>
        <SettingsPanel.Header title="Access" />
        <SettingsPanel.Notice>Seeing and changing who can reach {environment?.label ?? "this environment"} needs a session that manages access. Pair again by address or over SSH for one.</SettingsPanel.Notice>
      </SettingsPanel.Root>
    );
  }
  const toggle = (scope: AuthScope, on: boolean) => setScopes((current) => new Set(on ? [...current, scope] : [...current].filter((each) => each !== scope)));
  return (
    <SettingsPanel.Root>
      <SettingsPanel.Header title="Access" description={`Every app and agent that can reach ${environment?.label ?? "this environment"}, and what each may do.`} />
      <SettingsPanel.Group title="Paired">
        {(sessions.data ?? []).map((session) => (
          <SettingsPanel.Row
            key={session.id}
            label={
              <span>
                {session.label}
                <span className="text-muted-foreground">{session.current ? " this app" : session.audience === "mcp" ? " an agent" : ""}</span>
              </span>
            }
            description={`${scopesInWords(session.scopes)}. Seen ${formatAge(session.lastSeenAt ?? session.createdAt)} ago.`}
          >
            {session.current ? null : (
              <Button
                variant="destructive"
                size="xs"
                onClick={() =>
                  void runtime.run(environmentId, (client) => client["access.revokeSession"]({ id: session.id })).then(
                    () => {
                      toast.add({ title: `${session.label} can't reach it any more` });
                      void refresh();
                    },
                    (error: unknown) => toast.add({ title: "That didn't work", description: error instanceof Error ? error.message : "" }),
                  )
                }
              >
                Revoke
              </Button>
            )}
          </SettingsPanel.Row>
        ))}
      </SettingsPanel.Group>
      <SettingsPanel.Group title="New pairing code">
        {ALL_SCOPES.map((scope) => (
          <SettingsPanel.Row key={scope} label={SCOPE_WORDS[scope].charAt(0).toUpperCase() + SCOPE_WORDS[scope].slice(1)}>
            <Switch checked={scopes.has(scope)} onCheckedChange={(on) => toggle(scope, on)} aria-label={SCOPE_WORDS[scope]} />
          </SettingsPanel.Row>
        ))}
        <div className="flex items-center gap-3 pt-2">
          <Button
            variant="secondary"
            disabled={scopes.size === 0}
            onClick={() =>
              void runtime.run(environmentId, (client) => client["access.createPairingCode"]({ scopes: [...scopes] })).then(setCode, (error: unknown) =>
                toast.add({ title: "No code made", description: error instanceof Error ? error.message : "" }),
              )
            }
          >
            Make a code
          </Button>
          {code ? <span className="enter font-mono">{code.code}</span> : null}
          {code ? <span className="text-muted-foreground text-[13px]">works once, until {new Date(code.expiresAt).toLocaleTimeString()}</span> : null}
        </div>
      </SettingsPanel.Group>
    </SettingsPanel.Root>
  );
}

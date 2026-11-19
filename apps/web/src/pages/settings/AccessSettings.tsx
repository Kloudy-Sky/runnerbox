import { ALL_SCOPES, type AuthScope, type PairingCode } from "@runnerbox/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import { SettingsIntro } from "../../components/settings/SettingsIntro.tsx";
import { SettingsPageContainer, SettingsRow, SettingsSection, SettingsUnavailableGroup } from "../../components/settings/settingsLayout.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Switch } from "../../components/ui/switch.tsx";
import { toastManager } from "../../components/ui/toast.tsx";
import { useActiveEnvironment } from "../../hooks/useEnvironment.ts";
import { answerOf } from "../../lib/answer.ts";
import { appAtomRegistry } from "../../rpc/atomRegistry.ts";
import { sessionsAtom } from "../../state/access.ts";
import { formatAge } from "../../lib/format.ts";
import { SCOPE_WORDS } from "../../lib/vocabulary.ts";
import { runtime } from "../../runtime.ts";

const capitalize = (words: string) => words.charAt(0).toUpperCase() + words.slice(1);

const scopesInWords = (scopes: ReadonlyArray<AuthScope>) => {
  const words = scopes.map((scope) => SCOPE_WORDS[scope]);
  return capitalize(words.length <= 1 ? (words[0] ?? "nothing") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`);
};

// After T3 Code's authorized clients panel: every device and agent that can reach this
// environment, what each may do, and a new pairing code with exactly the access you pick.
export function AccessSettings() {
  const { environment } = useActiveEnvironment();
  const environmentId = environment?.environmentId ?? "";
  const canManage = environment?.scopes.includes("access:write") ?? false;
  // A session that can't manage access reads no machine, which never asks: the server would refuse.
  const sessions = answerOf(useAtomValue(sessionsAtom(canManage ? environmentId : "")));
  const [scopes, setScopes] = useState<ReadonlySet<AuthScope>>(new Set<AuthScope>(["history:read", "runners:read"]));
  const [code, setCode] = useState<PairingCode | null>(null);
  const refresh = () => appAtomRegistry.refresh(sessionsAtom(environmentId));
  if (!canManage) {
    return (
      <SettingsPageContainer>
        <SettingsSection title="Access">
          <SettingsUnavailableGroup message={`Seeing and changing who can reach ${environment?.label ?? "this environment"} needs a session that manages access. Pair again by address or over SSH for one.`}>{null}</SettingsUnavailableGroup>
        </SettingsSection>
      </SettingsPageContainer>
    );
  }
  const toggle = (scope: AuthScope, on: boolean) => setScopes((current) => new Set(on ? [...current, scope] : [...current].filter((each) => each !== scope)));
  return (
    <SettingsPageContainer>
      <SettingsIntro>Every app and agent that can reach {environment?.label ?? "this environment"}, and what each may do.</SettingsIntro>
      <SettingsSection title="Paired">
        {(sessions.data ?? []).map((session) => (
          <SettingsRow
            key={session.id}
            title={
              <>
                {session.label}
                <span className="font-normal text-muted-foreground">{session.current ? " this app" : session.audience === "mcp" ? " an agent" : ""}</span>
              </>
            }
            description={`${scopesInWords(session.scopes)}. Seen ${formatAge(session.lastSeenAt ?? session.createdAt)} ago.`}
            control={
              session.current ? null : (
                <Button
                  variant="ghost-destructive"
                  size="xs"
                  onClick={() =>
                    void runtime.run(environmentId, (client) => client["access.revokeSession"]({ id: session.id })).then(
                      () => {
                        toastManager.add({ title: `${session.label} can't reach it any more` });
                        void refresh();
                      },
                      (error: unknown) => toastManager.add({ title: "That didn't work", description: error instanceof Error ? error.message : "" }),
                    )
                  }
                >
                  Revoke
                </Button>
              )
            }
          />
        ))}
      </SettingsSection>
      <SettingsSection title="New pairing code">
        {ALL_SCOPES.map((scope) => (
          <SettingsRow key={scope} title={capitalize(SCOPE_WORDS[scope])} control={<Switch checked={scopes.has(scope)} onCheckedChange={(on) => toggle(scope, on)} aria-label={SCOPE_WORDS[scope]} />} />
        ))}
        <SettingsRow
          title={code ? <span className="enter font-mono">{code.code}</span> : "Code"}
          description={code ? `works once, until ${new Date(code.expiresAt).toLocaleTimeString()}` : undefined}
          control={
            <Button
              variant="outline"
              size="sm"
              disabled={scopes.size === 0}
              onClick={() =>
                void runtime.run(environmentId, (client) => client["access.createPairingCode"]({ scopes: [...scopes] })).then(setCode, (error: unknown) =>
                  toastManager.add({ title: "No code made", description: error instanceof Error ? error.message : "" }),
                )
              }
            >
              Make a code
            </Button>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

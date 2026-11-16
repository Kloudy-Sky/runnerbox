import { useState } from "react";
import { SettingsIntro } from "../../components/settings/SettingsIntro.tsx";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "../../components/settings/settingsLayout.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../components/ui/select.tsx";
import { Switch } from "../../components/ui/switch.tsx";
import { Textarea } from "../../components/ui/textarea.tsx";
import { useReviews } from "../../hooks/useReviews.ts";

// GitHub's page for a new App, with what reviews need already filled in: pull requests and checks
// to write, code to read, and no webhook, since the server asks GitHub and is never called by it.
const NEW_APP_URL = `https://github.com/settings/apps/new?${new URLSearchParams({ description: "Reviews pull requests from a runnerbox server.", webhook_active: "false", pull_requests: "write", checks: "write", contents: "read" })}`;
const link = "text-foreground underline-offset-4 hover:underline";
const words = (cause: unknown) => (cause instanceof Error ? cause.message : "That didn't work.");

// The owner's App ID and private key, sent once. The key field never shows a stored key.
function ConnectApp({ connect }: { connect: (appId: string, privateKey: string) => Promise<void> }) {
  const [appId, setAppId] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    setBusy(true);
    setError(null);
    void connect(appId.trim(), privateKey.trim())
      .catch((cause: unknown) => setError(words(cause)))
      .finally(() => setBusy(false));
  };
  return (
    <SettingsSection title="GitHub">
      <SettingsRow
        title="1. Make a GitHub App"
        description="GitHub opens with the permissions filled in. Give it a name and a homepage, pick who can install it, and install it on the repositories to review."
        control={
          <a href={NEW_APP_URL} target="_blank" rel="noreferrer noopener" className={link}>
            Create on GitHub
          </a>
        }
      />
      <SettingsRow title="2. App ID" description="On the App's page, under About." control={<Input className="w-40" size="sm" inputMode="numeric" value={appId} onValueChange={setAppId} aria-label="App ID" />} />
      <SettingsRow title="3. Private key" description="Generate one on the App's page and paste the whole .pem file. It's kept on the server's machine and never shown again.">
        <Textarea className="mt-2 font-mono text-xs" rows={4} value={privateKey} onChange={(event) => setPrivateKey(event.target.value)} aria-label="Private key" spellCheck={false} />
        <div className="flex items-center gap-3 py-3">
          <Button size="sm" disabled={busy || !/^\d+$/.test(appId.trim()) || privateKey.trim() === ""} onClick={submit}>
            Connect
          </Button>
          {error ? <span className="text-destructive text-xs">{error}</span> : null}
        </div>
      </SettingsRow>
    </SettingsSection>
  );
}

// Reviews: which repositories are read, and the GitHub App they're read through.
export function ReviewsSettings() {
  const { view, available, connect, disconnect, setRepo, setModel } = useReviews();
  const [error, setError] = useState<string | null>(null);
  if (!available) return <SettingsPageContainer><SettingsIntro>This server is older than reviews. Update it under About.</SettingsIntro></SettingsPageContainer>;
  if (view === null) return null;
  const act = (work: Promise<void>) => {
    setError(null);
    work.catch((cause: unknown) => setError(words(cause)));
  };
  const { app, canConfigure } = view;
  return (
    <SettingsPageContainer>
      <SettingsIntro>
        Runnerbox reads the open pull requests on the repositories you turn on, through a GitHub App you make. A pull request opened after that is reviewed on its own, and again on every push once it's quiet for a minute. Drafts, bots' and forks' are left for you to ask. Findings show under Reviews and are posted nowhere.
      </SettingsIntro>
      {app === null ? (
        canConfigure ? <ConnectApp connect={connect} /> : <SettingsIntro>No GitHub App is connected, and this device can't connect one.</SettingsIntro>
      ) : (
        <>
          <SettingsSection title="Repositories">
            {view.repos.map(({ repo, review }) => (
              <SettingsRow key={repo} title={repo} control={<Switch checked={review} disabled={!canConfigure} onCheckedChange={(next) => act(setRepo(repo, next))} aria-label={`Review ${repo}`} />} />
            ))}
            {view.repos.length === 0 ? <SettingsRow title="The App isn't installed on a repository yet" description={view.problem ?? undefined} /> : null}
            {error ? <p className="px-3 py-3 text-destructive text-xs sm:px-4">{error}</p> : null}
          </SettingsSection>
          {view.models !== undefined && view.model !== undefined ? (
            <SettingsSection title="Reviewer">
              <SettingsRow
                title="Model"
                description="Reviews run on your Claude account, one at a time, and at most 40 a day start on their own."
                control={
                  <Select value={view.model} disabled={!canConfigure} onValueChange={(value) => value && act(setModel(value))}>
                    <SelectTrigger className="w-32" aria-label="Review model">
                      <SelectValue>{() => view.models?.find((each) => each.id === view.model)?.label ?? view.model}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      {view.models.map((each) => (
                        <SelectItem key={each.id} value={each.id}>
                          {each.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                }
              />
            </SettingsSection>
          ) : null}
          <SettingsSection title="GitHub">
            <SettingsRow
              title={`Connected as ${app.name}`}
              description={
                <a href={`https://github.com/apps/${encodeURIComponent(app.slug)}/installations/new`} target="_blank" rel="noreferrer noopener" className={link}>
                  Install it on more repositories
                </a>
              }
              control={
                canConfigure ? (
                  <Button size="sm" variant="destructive-outline" onClick={() => act(disconnect())}>
                    Disconnect
                  </Button>
                ) : undefined
              }
            />
          </SettingsSection>
        </>
      )}
    </SettingsPageContainer>
  );
}

import type { GitHubSignInPrompt, GitHubStatus } from "@runnerbox/contracts";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { SettingsIntro } from "../../components/settings/SettingsIntro.tsx";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "../../components/settings/settingsLayout.tsx";
import { StatusDot } from "../../components/settings/StatusDot.tsx";
import { Button } from "../../components/ui/button.tsx";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard.ts";
import { useGitHub } from "../../hooks/useGitHub.ts";
import { useReviews } from "../../hooks/useReviews.ts";
import type { RootSearch } from "../../lib/search.ts";

const link = "text-foreground underline-offset-4 hover:underline";
const outside = { target: "_blank", rel: "noreferrer noopener" } as const;
const words = (cause: unknown) => (cause instanceof Error ? cause.message : "That didn't work.");
const FAILED: Record<NonNullable<GitHubStatus["failure"]>, string> = {
  denied: "The sign-in was turned down on GitHub.",
  expired: "The code ran out before it was approved.",
  failed: "GitHub didn't finish the sign-in. Try again.",
};

// The code to type on GitHub, a character to a cell so it reads at a glance. Opening GitHub copies it first.
function SignInCode({ prompt, cancel }: { prompt: GitHubSignInPrompt; cancel: () => void }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  return (
    <SettingsRow title="Enter this code on GitHub" description={`It works until ${new Date(prompt.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. This page updates once you approve it.`}>
      <div className="flex flex-wrap items-center gap-1 pt-2 font-mono text-lg font-semibold" aria-label={`Code ${prompt.userCode}`}>
        {[...prompt.userCode].map((character, index) =>
          character === "-" ? (
            <span key={index} aria-hidden className="px-0.5 text-muted-foreground">
              -
            </span>
          ) : (
            <span key={index} aria-hidden className="rounded-md bg-muted px-2 py-1">
              {character}
            </span>
          ),
        )}
      </div>
      <div className="flex items-center gap-2 py-3">
        <Button size="sm" render={<a href={prompt.verificationUri} {...outside} />} onClick={() => copyToClipboard(prompt.userCode)}>
          {isCopied ? "Copied. Opening GitHub" : "Copy code and open GitHub"}
        </Button>
        <Button size="sm" variant="outline" onClick={cancel}>
          Cancel
        </Button>
      </div>
    </SettingsRow>
  );
}

// GitHub: the server's sign-in through the shared App, and where that App is installed. What reads
// through it, such as reviews, keeps its own switches on its own page.
export function GitHubSettings() {
  const { available, status, signIn, cancel, signOut } = useGitHub();
  const { view: reviews } = useReviews();
  const [error, setError] = useState<string | null>(null);
  if (!available)
    return (
      <SettingsPageContainer>
        <SettingsIntro>This server is older than the GitHub sign-in. Update it under About.</SettingsIntro>
      </SettingsPageContainer>
    );
  if (status === null) return null;
  const { app, account, pending, canConfigure } = status;
  if (app === null)
    return (
      <SettingsPageContainer>
        <SettingsIntro>This server has no GitHub App to sign in through.</SettingsIntro>
      </SettingsPageContainer>
    );
  const act = (work: Promise<void>) => {
    setError(null);
    work.catch((cause: unknown) => setError(words(cause)));
  };
  const installUrl = `https://github.com/apps/${encodeURIComponent(app.slug)}/installations/new`;
  const reviewed = reviews?.repos.filter(({ review }) => review).length ?? 0;
  return (
    <SettingsPageContainer>
      <SettingsIntro>
        The server signs in to GitHub as you, through the {app.name} app, and reads the repositories that app is installed on. The token stays on the server's machine.
      </SettingsIntro>
      <SettingsSection title="Account">
        {pending !== null ? (
          <SignInCode prompt={pending} cancel={() => act(cancel())} />
        ) : account !== null ? (
          <SettingsRow
            title={
              <span className="flex items-center gap-2">
                <StatusDot available />
                Signed in as {account}
              </span>
            }
            control={
              canConfigure ? (
                <Button size="sm" variant="destructive-outline" onClick={() => act(signOut())}>
                  Sign out
                </Button>
              ) : undefined
            }
          />
        ) : (
          <SettingsRow
            title="Not signed in"
            description={status.failure !== null ? FAILED[status.failure] : canConfigure ? undefined : "This device can't sign the server in."}
            control={
              canConfigure ? (
                <Button size="sm" onClick={() => act(signIn())}>
                  Sign in with GitHub
                </Button>
              ) : undefined
            }
          />
        )}
        {error ? <p className="px-3 py-3 text-destructive text-xs sm:px-4">{error}</p> : null}
      </SettingsSection>
      {account !== null ? (
        <>
          <SettingsSection title="Installed on">
            {status.installations.map(({ account: owner, repositories, manageUrl }) => (
              <SettingsRow
                key={manageUrl ?? owner}
                title={owner}
                description={repositories === null ? "All repositories" : repositories === 1 ? "1 repository" : `${repositories} repositories`}
                control={
                  manageUrl !== null ? (
                    <a href={manageUrl} {...outside} className={link}>
                      Manage on GitHub
                    </a>
                  ) : undefined
                }
              />
            ))}
            {status.problem !== null ? <SettingsRow title="GitHub couldn't be asked" description={status.problem} /> : null}
            <SettingsRow
              title={status.installations.length === 0 ? `${app.name} isn't installed on an account yet` : "Another account or organization"}
              control={
                <a href={installUrl} {...outside} className={link}>
                  Install on GitHub
                </a>
              }
            />
          </SettingsSection>
          <SettingsSection title="Used by">
            <SettingsRow
              title="Reviews"
              description={reviewed === 1 ? "1 repository on" : `${reviewed} repositories on`}
              control={
                <Link to="/settings/reviews" search={(previous: RootSearch) => previous} className={link}>
                  Choose repositories
                </Link>
              }
            />
          </SettingsSection>
        </>
      ) : null}
    </SettingsPageContainer>
  );
}

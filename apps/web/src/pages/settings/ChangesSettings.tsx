import { ProposalBlock } from "../../components/proposals/ProposalBlock.tsx";
import { SettingsIntro } from "../../components/settings/SettingsIntro.tsx";
import { SettingsPageContainer, SettingsSection } from "../../components/settings/settingsLayout.tsx";
import { useProposals } from "../../hooks/useProposals.ts";

// Every change the agent proposed to an install's numbers, newest first: what's waiting for a
// decision, and what was applied, with Revert, which proposes the previous values back.
export function ChangesSettings() {
  const actions = useProposals();
  return (
    <SettingsPageContainer>
      <SettingsIntro>Changes the agent proposed to how many jobs run at once and how much memory and CPU they get. Nothing changes until you approve.</SettingsIntro>
      <SettingsSection title="Proposals">
        {actions.proposals.length === 0 ? (
          <p className="px-3 py-3 text-muted-foreground text-xs sm:px-4">
            No proposals yet. A machine takes them only when its runnerbox config has <code className="font-mono">"changes": true</code>.
          </p>
        ) : null}
        {actions.proposals.map((proposal) => (
          <div key={proposal.id} className="px-3 py-3 sm:px-4">
            <ProposalBlock proposal={proposal} actions={actions} offerRevert />
          </div>
        ))}
      </SettingsSection>
    </SettingsPageContainer>
  );
}

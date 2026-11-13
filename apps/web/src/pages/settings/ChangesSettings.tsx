import { SettingsPanel } from "../../components/settings/SettingsPanel.tsx";
import { ProposalBlock } from "../../components/proposals/ProposalBlock.tsx";
import { useProposals } from "../../hooks/useProposals.ts";

// Every change the agent proposed to an install's numbers, newest first: what's waiting for a
// decision, and what was applied, with Revert, which proposes the previous values back.
export function ChangesSettings() {
  const actions = useProposals();
  return (
    <SettingsPanel.Root>
      <SettingsPanel.Header title="Changes" description="Changes the agent proposed to how many jobs run at once and how much memory and CPU they get. Nothing changes until you approve." />
      {actions.proposals.length === 0 ? (
        <SettingsPanel.Notice>
          No proposals yet. A machine takes them only when its runnerbox config has <code className="font-mono">"changes": true</code>.
        </SettingsPanel.Notice>
      ) : null}
      {actions.proposals.map((proposal) => (
        <ProposalBlock key={proposal.id} proposal={proposal} actions={actions} offerRevert />
      ))}
    </SettingsPanel.Root>
  );
}

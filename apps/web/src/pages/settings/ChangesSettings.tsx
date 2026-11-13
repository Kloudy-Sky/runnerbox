import { SettingsPanel } from "../../components/settings/SettingsPanel.tsx";
import { ProposalBlock } from "../../components/proposals/ProposalBlock.tsx";
import { useProposals } from "../../hooks/useProposals.ts";

// Every change the agent proposed to an install's numbers, newest first: what's waiting for a
// decision, and what was applied, with Revert, which proposes the previous values back.
export function ChangesSettings() {
  const actions = useProposals();
  return (
    <SettingsPanel.Root>
      <SettingsPanel.Header
        title="Changes"
        description="Changes the agent proposed to an install's numbers: how many jobs a kind runs at once, memory kept free, and a kind's memory and CPU limits. Nothing changes until you approve. They can't touch tokens, which repositories or workflows use your runners, images, environment variables or the VM. An install takes them only when its config has changes: true."
      />
      {actions.proposals.length === 0 ? <SettingsPanel.Notice>No proposals yet.</SettingsPanel.Notice> : null}
      {actions.proposals.map((proposal) => (
        <ProposalBlock key={proposal.id} proposal={proposal} actions={actions} offerRevert />
      ))}
    </SettingsPanel.Root>
  );
}

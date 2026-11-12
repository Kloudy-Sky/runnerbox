import { useState } from "react";
import { useStore } from "zustand";
import { ConnectionState } from "../../components/ConnectionState.tsx";
import { ConnectSection } from "../../components/ConnectSection.tsx";
import { PairForm } from "../../components/PairForm.tsx";
import { SettingsPanel } from "../../components/settings/SettingsPanel.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from "../../components/ui/dialog.tsx";
import { useActiveEnvironment } from "../../hooks/useEnvironment.ts";
import { routeAddress, routePhrase } from "../../lib/routes.ts";
import { runtime } from "../../runtime.ts";
import { usePreferences } from "../../state/preferences.ts";

// After T3 Code's connections panel: the environments this app has paired with, how it reaches each,
// and adding or forgetting one.
export function ConnectionsSettings() {
  const environments = useStore(runtime.store, (state) => state.environments);
  const connections = useStore(runtime.store, (state) => state.connections);
  const { environment } = useActiveEnvironment();
  const setActive = usePreferences((state) => state.setActive);
  const [adding, setAdding] = useState(false);
  return (
    <SettingsPanel.Root>
      <SettingsPanel.Header title="Connections" description="The runnerbox servers this app has paired with. Each is one machine and its history." />
      <SettingsPanel.Group>
        {environments.map((saved) => (
          <SettingsPanel.Row
            key={saved.environmentId}
            label={
              <span>
                {saved.label}
                {saved.environmentId === environment?.environmentId ? <span className="text-muted-foreground"> shown now</span> : null}
              </span>
            }
            description={saved.routes.map((route) => `${routePhrase(route)}, ${routeAddress(route)}`).join("; ")}
          >
            <ConnectionState connection={connections[saved.environmentId]} className="text-[13px]" />
            {saved.environmentId === environment?.environmentId ? null : (
              <Button variant="ghost-muted" size="xs" onClick={() => setActive(saved.environmentId)}>
                Show
              </Button>
            )}
            <Button variant="destructive" size="xs" onClick={() => void runtime.remove(saved.environmentId)}>
              Forget
            </Button>
          </SettingsPanel.Row>
        ))}
      </SettingsPanel.Group>
      <div>
        <Button variant="secondary" onClick={() => setAdding(true)}>
          Add environment
        </Button>
      </div>
      <ConnectSection />
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogPopup className="max-w-lg">
          <DialogTitle>Add environment</DialogTitle>
          <DialogDescription>
            Run <code className="font-mono text-foreground">runnerbox pair</code> on that machine for a code, or pair over SSH and leave the code empty.
          </DialogDescription>
          <PairForm
            onPaired={(id) => {
              setActive(id);
              setAdding(false);
            }}
          />
        </DialogPopup>
      </Dialog>
    </SettingsPanel.Root>
  );
}

import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { useStore } from "zustand";
import { ConnectionState } from "../../components/ConnectionState.tsx";
import { ConnectSection } from "../../components/ConnectSection.tsx";
import { PairForm } from "../../components/PairForm.tsx";
import { SettingsIntro } from "../../components/settings/SettingsIntro.tsx";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "../../components/settings/settingsLayout.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Dialog, DialogDescription, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "../../components/ui/dialog.tsx";
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
    <SettingsPageContainer>
      <SettingsIntro>The runnerbox servers this app has paired with. Each is one machine and its history.</SettingsIntro>
      <SettingsSection
        title="Environments"
        headerAction={
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <PlusIcon className="size-3.5" /> Add environment
          </Button>
        }
      >
        {environments.map((saved) => (
          <SettingsRow
            key={saved.environmentId}
            title={
              <>
                {saved.label}
                {saved.environmentId === environment?.environmentId ? <span className="font-normal text-muted-foreground"> shown now</span> : null}
              </>
            }
            description={saved.routes.map((route) => `${routePhrase(route)}, ${routeAddress(route)}`).join("; ")}
            control={
              <>
                <ConnectionState connection={connections[saved.environmentId]} className="text-xs" />
                {saved.environmentId === environment?.environmentId ? null : (
                  <Button variant="ghost-muted" size="xs" onClick={() => setActive(saved.environmentId)}>
                    Show
                  </Button>
                )}
                <Button variant="ghost-destructive" size="xs" onClick={() => void runtime.remove(saved.environmentId)}>
                  Forget
                </Button>
              </>
            }
          />
        ))}
      </SettingsSection>
      <div className="px-3 sm:px-4">
        <ConnectSection />
      </div>
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogPopup className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add environment</DialogTitle>
            <DialogDescription>
              Run <code className="font-mono text-foreground">runnerbox pair</code> on that machine for a code, or pair over SSH and leave the code empty.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <PairForm
              onPaired={(id) => {
                setActive(id);
                setAdding(false);
              }}
            />
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </SettingsPageContainer>
  );
}

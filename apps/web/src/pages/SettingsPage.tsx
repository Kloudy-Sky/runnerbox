import { PageHeader } from "../components/PageHeader.tsx";
import { ConnectPage } from "./ConnectPage.tsx";

// Environments and access for now. Its own sections, after T3 Code's settings panel, come next.
export function SettingsPage() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-6">
      <PageHeader.Root>
        <PageHeader.Title>Settings</PageHeader.Title>
      </PageHeader.Root>
      <div className="px-3">
        <ConnectPage />
      </div>
    </div>
  );
}

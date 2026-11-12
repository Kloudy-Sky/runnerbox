import { useState } from "react";
import { Input } from "../components/ui/input.tsx";
import { Button } from "../components/ui/button.tsx";
import { useStore } from "zustand";
import { ConnectionState } from "../components/ConnectionState.tsx";
import { Heading } from "../components/Heading.tsx";
import { AccessPanel } from "../components/AccessPanel.tsx";
import { ConnectSection } from "../components/ConnectSection.tsx";
import { useActiveEnvironment } from "../hooks/useEnvironment.ts";
import { routeAddress, routeKind } from "../lib/routes.ts";
import { runtime } from "../runtime.ts";
import { usePreferences } from "../state/preferences.ts";


export function ConnectPage() {
  const environments = useStore(runtime.store, (state) => state.environments);
  const connections = useStore(runtime.store, (state) => state.connections);
  const { environment } = useActiveEnvironment();
  const setActive = usePreferences((state) => state.setActive);
  return (
    <div className="max-w-3xl px-3 py-2">
      {environments.length > 0 ? (
        <>
          <Heading>Environments</Heading>
          <table className="w-full border-collapse">
            <tbody>
              {environments.map((saved) => (
                <tr key={saved.environmentId} className={saved.environmentId === environment?.environmentId ? "bg-accent" : ""}>
                  <td className="py-0.5 pr-3 pl-1">{saved.label}</td>
                  <td className="py-0.5 pr-3 text-muted-foreground">{saved.routes.map(routeKind).join(", ")}</td>
                  <td className="py-0.5 pr-3 text-muted-foreground">{saved.routes.map(routeAddress).join(", ")}</td>
                  <td className="py-0.5 pr-3"><ConnectionState connection={connections[saved.environmentId]} /></td>
                  <td className="py-0.5 pr-3 text-muted-foreground">{saved.scopes.join(" ")}</td>
                  <td className="py-0.5 pr-1 text-right whitespace-nowrap">
                    <Button variant="ghost-muted" size="xs" onClick={() => setActive(saved.environmentId)}>Show</Button>
                    <Button variant="destructive" size="xs" onClick={() => void runtime.remove(saved.environmentId)}>Forget</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="pt-3">Pair with a runnerbox server. On the machine that runs it, start <code className="bg-surface px-1">runnerbox serve</code>, which prints a pairing code, or run <code className="bg-surface px-1">runnerbox pair</code> for a new one.</p>
      )}
      <PairForm onPaired={(id) => setActive(id)} />
      <ConnectSection />
      {environment?.scopes.includes("access:write") ? <AccessPanel /> : null}
    </div>
  );
}

function PairForm({ onPaired }: { onPaired: (environmentId: string) => void }) {
  const [mode, setMode] = useState<"direct" | "ssh">("direct");
  const [url, setUrl] = useState("http://127.0.0.1:4517");
  const [host, setHost] = useState("");
  const [sshPort, setSshPort] = useState("");
  const [remotePort, setRemotePort] = useState("4517");
  const [serverCommand, setServerCommand] = useState("node ~/runnerbox/runnerbox.js");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const label = "desktop";
    const paired =
      mode === "direct"
        ? runtime.pairDirect(url.trim(), code.trim(), label)
        : runtime.pairSsh(
            { kind: "ssh", host: host.trim(), sshPort: sshPort ? Number(sshPort) : null, remotePort: Number(remotePort), serverCommand: serverCommand.trim() },
            code.trim() || null,
            label,
          );
    await paired.then(
      (saved) => {
        setCode("");
        onPaired(saved.environmentId);
      },
      (failure: unknown) => setError(failure instanceof Error ? failure.message : "Pairing failed."),
    );
    setBusy(false);
  }

  return (
    <form onSubmit={submit}>
      <Heading>Pair</Heading>
      {runtime.canUseSsh ? (
        <div className="flex gap-4 pb-2">
          <Button size="sm" variant={mode === "direct" ? "secondary" : "ghost-muted"} onClick={() => setMode("direct")}>By address</Button>
          <Button size="sm" variant={mode === "ssh" ? "secondary" : "ghost-muted"} onClick={() => setMode("ssh")}>Over SSH</Button>
        </div>
      ) : null}
      <div className="grid max-w-xl grid-cols-[9rem_1fr] items-center gap-x-3 gap-y-1.5">
        {mode === "direct" ? (
          <>
            <label htmlFor="url" className="text-muted-foreground">Server address</label>
            <Input id="url" value={url} onChange={(event) => setUrl(event.target.value)} />
          </>
        ) : (
          <>
            <label htmlFor="host" className="text-muted-foreground">SSH host</label>
            <Input id="host" value={host} placeholder="example, or user@example" onChange={(event) => setHost(event.target.value)} />
            <label htmlFor="sshPort" className="text-muted-foreground">SSH port</label>
            <Input id="sshPort" value={sshPort} placeholder="from ~/.ssh/config, or 22" onChange={(event) => setSshPort(event.target.value)} />
            <label htmlFor="remotePort" className="text-muted-foreground">Server port there</label>
            <Input id="remotePort" value={remotePort} onChange={(event) => setRemotePort(event.target.value)} />
            <label htmlFor="serverCommand" className="text-muted-foreground">Server command</label>
            <Input id="serverCommand" value={serverCommand} onChange={(event) => setServerCommand(event.target.value)} />
          </>
        )}
        <label htmlFor="code" className="text-muted-foreground">Pairing code</label>
        <Input id="code" font="mono" value={code} placeholder={mode === "ssh" ? "leave empty to fetch one over SSH" : "XXXXX-XXXXX-XXXXX-XXXXX"} onChange={(event) => setCode(event.target.value)} />
        <span />
        <div className="flex items-center gap-3 pt-1">
          <Button type="submit" disabled={busy}>{busy ? "Pairing" : "Pair"}</Button>
          {error ? <span className="text-destructive">{error}</span> : null}
        </div>
      </div>
    </form>
  );
}

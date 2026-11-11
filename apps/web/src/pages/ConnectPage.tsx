import { useState } from "react";
import { useStore } from "zustand";
import { ConnectionState } from "../components/ConnectionState.tsx";
import { Heading } from "../components/Heading.tsx";
import { AccessPanel } from "../components/AccessPanel.tsx";
import { ConnectSection } from "../components/ConnectSection.tsx";
import { useActiveEnvironment } from "../hooks/useEnvironment.ts";
import { routeAddress, routeKind } from "../lib/routes.ts";
import { runtime } from "../runtime.ts";
import { usePreferences } from "../state/preferences.ts";

const field = "bg-surf px-2 py-0.5 text-fg outline-none placeholder:text-faint";

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
                <tr key={saved.environmentId} className={saved.environmentId === environment?.environmentId ? "bg-surf2" : ""}>
                  <td className="py-0.5 pr-3 pl-1">{saved.label}</td>
                  <td className="py-0.5 pr-3 text-dim">{saved.routes.map(routeKind).join(", ")}</td>
                  <td className="py-0.5 pr-3 text-dim">{saved.routes.map(routeAddress).join(", ")}</td>
                  <td className="py-0.5 pr-3"><ConnectionState connection={connections[saved.environmentId]} /></td>
                  <td className="py-0.5 pr-3 text-dim">{saved.scopes.join(" ")}</td>
                  <td className="py-0.5 pr-1 text-right whitespace-nowrap">
                    <button type="button" className="text-dim hover:text-fg" onClick={() => setActive(saved.environmentId)}>Show</button>
                    <button type="button" className="ml-3 text-dim hover:text-red" onClick={() => void runtime.remove(saved.environmentId)}>Forget</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="pt-3">Pair with a runnerbox server. On the machine that runs it, start <code className="bg-surf px-1">runnerbox-server serve</code>, which prints a pairing code, or run <code className="bg-surf px-1">runnerbox-server pair</code> for a new one.</p>
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
  const [serverCommand, setServerCommand] = useState("runnerbox-server");
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
          <button type="button" onClick={() => setMode("direct")} className={mode === "direct" ? "text-fg" : "text-dim"}>By address</button>
          <button type="button" onClick={() => setMode("ssh")} className={mode === "ssh" ? "text-fg" : "text-dim"}>Over SSH</button>
        </div>
      ) : null}
      <div className="grid max-w-xl grid-cols-[9rem_1fr] items-center gap-x-3 gap-y-1.5">
        {mode === "direct" ? (
          <>
            <label htmlFor="url" className="text-dim">Server address</label>
            <input id="url" className={field} value={url} onChange={(event) => setUrl(event.target.value)} />
          </>
        ) : (
          <>
            <label htmlFor="host" className="text-dim">SSH host</label>
            <input id="host" className={field} value={host} placeholder="example, or user@example" onChange={(event) => setHost(event.target.value)} />
            <label htmlFor="sshPort" className="text-dim">SSH port</label>
            <input id="sshPort" className={field} value={sshPort} placeholder="from ~/.ssh/config, or 22" onChange={(event) => setSshPort(event.target.value)} />
            <label htmlFor="remotePort" className="text-dim">Server port there</label>
            <input id="remotePort" className={field} value={remotePort} onChange={(event) => setRemotePort(event.target.value)} />
            <label htmlFor="serverCommand" className="text-dim">Server command</label>
            <input id="serverCommand" className={field} value={serverCommand} onChange={(event) => setServerCommand(event.target.value)} />
          </>
        )}
        <label htmlFor="code" className="text-dim">Pairing code</label>
        <input id="code" className={`${field} font-mono`} value={code} placeholder={mode === "ssh" ? "leave empty to fetch one over SSH" : "XXXXX-XXXXX-XXXXX-XXXXX"} onChange={(event) => setCode(event.target.value)} />
        <span />
        <div className="flex items-center gap-3 pt-1">
          <button type="submit" disabled={busy} className="bg-surf2 px-3 py-0.5 disabled:text-dim">{busy ? "Pairing" : "Pair"}</button>
          {error ? <span className="text-red">{error}</span> : null}
        </div>
      </div>
    </form>
  );
}

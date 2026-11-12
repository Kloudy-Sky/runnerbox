import { ConnectSection } from "../components/ConnectSection.tsx";
import { PairForm } from "../components/PairForm.tsx";
import { Reading } from "../components/Reading.tsx";
import { usePreferences } from "../state/preferences.ts";

// What the app shows before it has an environment: how to get a pairing code, and the form.
export function ConnectPage() {
  const setActive = usePreferences((state) => state.setActive);
  return (
    <Reading.Root>
      <Reading.Header>
        <Reading.Title>Pair with a runnerbox server</Reading.Title>
        <Reading.Meta>
          On the machine that runs it, start <code className="font-mono text-foreground">runnerbox serve</code>, which prints a pairing code, or run{" "}
          <code className="font-mono text-foreground">runnerbox pair</code> for a new one.
        </Reading.Meta>
      </Reading.Header>
      <PairForm onPaired={setActive} />
      <ConnectSection />
    </Reading.Root>
  );
}

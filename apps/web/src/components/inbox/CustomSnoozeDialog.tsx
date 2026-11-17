import { type ChangeEvent, useEffect, useId, useState } from "react";
import { create } from "zustand";
import { type CustomSnoozeInput, localSnoozeDate, localSnoozeTime, resolveCustomSnooze } from "../../lib/snoozePresets.ts";
import { Button } from "../ui/button.tsx";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "../ui/dialog.tsx";
import { Input } from "../ui/input.tsx";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select.tsx";

// Written after T3 Code's CustomSnoozeDialog: one dialog at a time, asked for with a promise that
// gives the picked time, or null when cancelled. Native date and time fields stand in for T3 Code's
// calendar, toggle group and number field, which runnerbox doesn't have.
type SnoozeChoice = { readonly snoozedUntil: string };
type Request = { readonly resolve: (choice: SnoozeChoice | null) => void };
const useRequest = create<{ request: Request | null }>(() => ({ request: null }));

export function requestCustomSnooze(): Promise<SnoozeChoice | null> {
  useRequest.getState().request?.resolve(null);
  return new Promise((resolve) => useRequest.setState({ request: { resolve } }));
}

function finish(choice: SnoozeChoice | null) {
  const request = useRequest.getState().request;
  useRequest.setState({ request: null });
  request?.resolve(choice);
}

const UNITS = { minutes: "Minutes", hours: "Hours", days: "Days" } as const;
const isUnit = (value: unknown): value is keyof typeof UNITS => typeof value === "string" && value in UNITS;

// Mounted once on the page that snoozes. Unmounting answers any open request with null.
export function CustomSnoozeDialogHost() {
  const request = useRequest((state) => state.request);
  useEffect(() => () => finish(null), []);
  return request ? <CustomSnoozeDialog /> : null;
}

function CustomSnoozeDialog() {
  const id = useId();
  const [initial] = useState(() => new Date(Date.now() + 3_600_000));
  const [mode, setMode] = useState<CustomSnoozeInput["mode"]>("date");
  const [date, setDate] = useState(localSnoozeDate(initial));
  const [time, setTime] = useState(localSnoozeTime(initial));
  const [amount, setAmount] = useState("2");
  const [unit, setUnit] = useState<keyof typeof UNITS>("hours");
  const [error, setError] = useState<string | null>(null);
  const input: CustomSnoozeInput = mode === "date" ? { mode, date, time } : { mode, amount, unit };
  const pick = (next: CustomSnoozeInput["mode"]) => {
    setMode(next);
    setError(null);
  };
  const edit = (set: (value: string) => void) => (event: ChangeEvent<HTMLInputElement>) => {
    set(event.target.value);
    setError(null);
  };
  return (
    <Dialog open onOpenChange={(open) => !open && finish(null)}>
      <DialogPopup className="sm:max-w-md">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            const snoozedUntil = resolveCustomSnooze(input, new Date());
            if (snoozedUntil) finish({ snoozedUntil });
            else setError(mode === "date" ? "Choose a date and time in the future." : "Enter a positive duration.");
          }}
        >
          <DialogHeader>
            <DialogTitle>Custom snooze</DialogTitle>
            <DialogDescription>It comes back at this time, or sooner if it fails again.</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-4">
              <div className="flex gap-1" role="group" aria-label="Schedule type">
                <Button type="button" size="sm" variant={mode === "date" ? "secondary" : "ghost-muted"} aria-pressed={mode === "date"} onClick={() => pick("date")}>
                  Date and time
                </Button>
                <Button type="button" size="sm" variant={mode === "duration" ? "secondary" : "ghost-muted"} aria-pressed={mode === "duration"} onClick={() => pick("duration")}>
                  Duration
                </Button>
              </div>
              {mode === "date" ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="flex min-w-0 flex-col gap-2" htmlFor={`${id}-date`}>
                    Date
                    <Input nativeInput id={`${id}-date`} type="date" required min={localSnoozeDate(new Date())} value={date} onChange={edit(setDate)} />
                  </label>
                  <label className="flex min-w-0 flex-col gap-2" htmlFor={`${id}-time`}>
                    Time
                    <Input nativeInput id={`${id}-time`} type="time" required value={time} onChange={edit(setTime)} />
                  </label>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="flex min-w-0 flex-col gap-2" htmlFor={`${id}-amount`}>
                    Snooze for
                    <Input nativeInput id={`${id}-amount`} type="number" min={0} step="any" required value={amount} onChange={edit(setAmount)} />
                  </label>
                  <div className="flex min-w-0 flex-col gap-2">
                    Unit
                    <Select value={unit} onValueChange={(value) => {
                        if (!isUnit(value)) return;
                        setUnit(value);
                        setError(null);
                      }}>
                      <SelectTrigger aria-label="Unit">
                        <SelectValue>{UNITS[unit]}</SelectValue>
                      </SelectTrigger>
                      <SelectPopup>
                        {Object.entries(UNITS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </div>
                </div>
              )}
              {error ? (
                <p role="alert" className="text-destructive">
                  {error}
                </p>
              ) : null}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => finish(null)}>
              Cancel
            </Button>
            <Button type="submit">Snooze</Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

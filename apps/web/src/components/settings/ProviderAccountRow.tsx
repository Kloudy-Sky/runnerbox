import type { ProviderAccount } from "@runnerbox/contracts";
import { billingWords, statusWords } from "../../lib/accountWords.ts";
import { cn } from "../../lib/utils.ts";
import { StatusDot } from "./StatusDot.tsx";

// One account in its driver's section, laid out as T3 Code's provider instance row in list mode
// (MIT, see THIRD_PARTY_NOTICES.md): the whole row selects it, and a line under the name says how
// it bills and whether it can run turns. An account that can't says what to do, under its row.
export function ProviderAccountRow({ account, selected, onSelect }: { account: ProviderAccount; selected: boolean; onSelect: (() => void) | undefined }) {
  const { available, fix } = account.status;
  return (
    <div
      data-slot="settings-row"
      className={cn("group relative flex items-center gap-3 px-3 py-3 transition-colors sm:px-4", selected ? "bg-foreground/[0.06]" : onSelect && "hover:bg-muted/25")}
    >
      {onSelect ? (
        <button
          type="button"
          className="absolute inset-0 cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          onClick={onSelect}
          aria-label={`Edit ${account.label}`}
          aria-pressed={selected}
        />
      ) : null}
      <span className="pointer-events-none min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{account.label}</span>
          {account.isDefault ? <span className="shrink-0 text-xs text-muted-foreground">default</span> : null}
        </span>
        <span className="mt-0.5 flex items-start gap-1.5 text-xs leading-normal text-muted-foreground/80">
          <span className="flex h-[1.45em] shrink-0 items-center">
            <StatusDot available={available} />
          </span>
          <span className="line-clamp-2 [overflow-wrap:anywhere]">
            {statusWords(account)} · {billingWords(account)} · model {account.model ?? "default"}
          </span>
        </span>
        {!available && fix ? <span className="mt-1 block text-xs text-warning [overflow-wrap:anywhere]">{fix}</span> : null}
      </span>
    </div>
  );
}

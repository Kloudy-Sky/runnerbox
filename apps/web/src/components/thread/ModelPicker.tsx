import type { Provider } from "@runnerbox/contracts";
import { CheckIcon, ChevronDownIcon, SearchIcon, StarIcon } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "~/lib/utils";
import { choiceAccount, effortsOf, type TurnChoice, withModel } from "../../lib/turnChoice.ts";
import { isProviderInstancePickerReady, type ProviderInstanceEntry, providerInstanceEntries } from "../../providerInstances.ts";
import { type FavoriteModel, useModelFavorites } from "../../state/modelFavorites.ts";
import { ComposerControl } from "../chat/ComposerControl";
import { ModelPickerSidebar } from "../chat/ModelPickerSidebar";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover.tsx";

type Row = FavoriteModel & { readonly entry: ProviderInstanceEntry; readonly label: string; readonly detail: string | null };

const NO_FAVORITES: ReadonlyArray<FavoriteModel> = [];
const ROW = "flex h-8 w-full min-w-0 shrink-0 cursor-pointer items-center gap-2 rounded-sm px-2 text-left text-sm outline-none hover:bg-foreground/[0.09] focus-visible:bg-foreground/[0.09] disabled:cursor-not-allowed disabled:opacity-64";
const COLUMN_HEAD = "flex h-8.25 -translate-y-px items-center gap-2 border-b border-border/70 pb-1.5 text-sm";

// An account's models: its own setting first, then each the server offers on its driver.
function rowsOf(providers: ReadonlyArray<Provider>, entry: ProviderInstanceEntry): ReadonlyArray<Row> {
  const found = choiceAccount(providers, entry.instanceId);
  if (!found) return [];
  const own = found.account.model;
  const ownLabel = own === null ? null : (found.provider.models.find((each) => each.id === own)?.label ?? own);
  return [
    { accountId: entry.instanceId, model: null, entry, label: "Default", detail: ownLabel },
    ...found.provider.models.map((model) => ({ accountId: entry.instanceId, model: model.id, entry, label: model.label, detail: null })),
  ];
}

// What a turn runs on, in the composer's row, laid out as T3 Code's model picker: a rail of
// favorites and providers (one per account), search across all of them, the picked provider's
// models, and the picked model's effort levels docked beside them. With no models to list and one
// account, there's no choice to make, so there's no picker.
export function ModelPicker(props: { providers: ReadonlyArray<Provider>; environmentId: string; choice: TurnChoice; onChoice: (choice: TurnChoice) => void }) {
  const { providers, environmentId, choice } = props;
  const entries = providerInstanceEntries(providers);
  const favorites = useModelFavorites((store) => store.byEnvironment[environmentId] ?? NO_FAVORITES);
  const toggleFavorite = useModelFavorites((store) => store.toggle);
  const [open, setOpen] = useState(false);
  const [rail, setRail] = useState<string>("favorites");
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  if (providers.every((provider) => provider.models.length === 0) && entries.length < 2) return null;

  const current = entries.find((entry) => entry.instanceId === choice.accountId);
  const allRows = entries.flatMap((entry) => rowsOf(providers, entry));
  const isFavorite = (row: FavoriteModel) => favorites.some((each) => each.accountId === row.accountId && each.model === row.model);
  const picked = allRows.find((row) => row.accountId === choice.accountId && row.model === choice.model);
  const modelLabel = picked ? (picked.model === null && picked.detail !== null ? picked.detail : picked.label) : "Model";
  const efforts = effortsOf(providers, choice);
  const effort = choice.effort ?? efforts?.default ?? null;
  const effortLabel = efforts?.levels.find((level) => level.id === effort)?.label ?? null;

  const needle = query.trim().toLowerCase();
  const rows = needle
    ? allRows.filter((row) => [row.label, row.model ?? "", row.detail ?? "", row.entry.displayName].some((text) => text.toLowerCase().includes(needle)))
    : rail === "favorites"
      ? allRows.filter(isFavorite)
      : allRows.filter((row) => row.accountId === rail);
  // Rows from more than one provider name theirs.
  const mixed = needle !== "" || rail === "favorites";

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) return;
    setQuery("");
    setRail(favorites.length > 0 ? "favorites" : (choice.accountId ?? entries[0]?.instanceId ?? "favorites"));
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={<ComposerControl size="xs" aria-label="Model and effort" />}>
        {current ? <ProviderInstanceIcon driverKind={current.driverKind} displayName={current.displayName} iconClassName="size-3.5" /> : null}
        <span data-composer-control-label>{modelLabel}</span>
        {effortLabel ? <span data-composer-control-label className="text-muted-foreground">{effortLabel}</span> : null}
        <ChevronDownIcon data-composer-control-chevron />
      </PopoverTrigger>
      <PopoverPopup side="top" align="end" padding="none" initialFocus={search}>
        <div className="flex h-80 max-w-[calc(100vw-2rem)]">
          <ModelPickerSidebar
            selectedInstanceId={needle ? "" : rail}
            onSelectInstance={(id) => {
              setRail(id);
              setQuery("");
            }}
            onFocusSearch={() => search.current?.focus()}
            instanceEntries={entries}
            showFavorites
          />
          <div className="flex w-64 min-w-0 flex-col">
            <div className="shrink-0 px-3 pt-2.5">
              <div className="relative -translate-y-px border-b border-border/70 pb-1.5 transition-colors focus-within:border-ring">
                <SearchIcon className="pointer-events-none absolute top-1.5 left-0 size-4 text-muted-foreground/55" aria-hidden />
                <input
                  ref={search}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search models"
                  aria-label="Search models"
                  className="h-6.5 w-full bg-transparent ps-5 text-sm leading-6.5 outline-none placeholder:text-muted-foreground/70"
                />
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain px-2 pt-2.5 pb-1.5" role="listbox" aria-label="Models">
              {rows.length === 0 ? (
                <p className="px-2 py-1.5 text-muted-foreground text-sm">{needle ? "No models match." : "Star a model to keep it here."}</p>
              ) : (
                rows.map((row) => {
                  const selected = row.accountId === choice.accountId && row.model === choice.model;
                  const starred = isFavorite(row);
                  return (
                    <div key={`${row.accountId}\u0000${row.model ?? ""}`} className="group flex items-center">
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        disabled={!isProviderInstancePickerReady(row.entry)}
                        className={cn(ROW, selected && "bg-foreground/[0.06]")}
                        // Stays open on a model, so its effort can be picked next, as in T3 Code.
                        onClick={() => props.onChoice(withModel(providers, choice, row.accountId, row.model))}
                      >
                        {mixed ? <ProviderInstanceIcon driverKind={row.entry.driverKind} displayName={row.entry.displayName} iconClassName="size-4" /> : null}
                        <span className="min-w-0 truncate">{row.label}</span>
                        {row.detail ? <span className="min-w-0 shrink truncate text-muted-foreground/70 text-xs">{row.detail}</span> : null}
                        {mixed ? <span className="sr-only">, {row.entry.displayName}</span> : null}
                        {selected ? <CheckIcon className="ms-auto size-3.5 shrink-0" aria-hidden /> : null}
                      </button>
                      <button
                        type="button"
                        aria-label={starred ? `Unstar ${row.label}` : `Star ${row.label}`}
                        aria-pressed={starred}
                        onClick={() => toggleFavorite(environmentId, { accountId: row.accountId, model: row.model })}
                        className={cn(
                          "flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground/70 outline-none hover:text-foreground focus-visible:opacity-100",
                          !starred && "opacity-0 group-hover:opacity-100",
                        )}
                      >
                        <StarIcon className={cn("size-3.5", starred && "fill-current text-amber-400")} aria-hidden />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
          <div className="flex w-40 shrink-0 flex-col border-border/70 border-l">
            <div className="shrink-0 px-3 pt-2.5">
              <div className={COLUMN_HEAD}>
                <span className="text-muted-foreground">Effort</span>
                <span className="ms-auto min-w-0 truncate text-muted-foreground text-xs">{modelLabel}</span>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain px-2 pt-2.5 pb-1.5" role="radiogroup" aria-label="Effort">
              {efforts && efforts.levels.length > 0 ? (
                efforts.levels.map((level) => (
                  <button
                    key={level.id}
                    type="button"
                    role="radio"
                    aria-checked={level.id === effort}
                    className={ROW}
                    onClick={() => {
                      // The model's default is kept as no pick, so it follows the model.
                      props.onChoice({ ...choice, effort: level.id === efforts.default ? null : level.id });
                      setOpen(false);
                    }}
                  >
                    <span className="min-w-0 truncate">{level.label}</span>
                    {level.id === efforts.default ? <span className="text-muted-foreground/70 text-xs">Default</span> : null}
                    {level.id === effort ? <CheckIcon className="ms-auto size-3.5 shrink-0" aria-hidden /> : null}
                  </button>
                ))
              ) : (
                <div className="flex h-8 items-center px-2 text-muted-foreground text-sm">No effort levels</div>
              )}
            </div>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

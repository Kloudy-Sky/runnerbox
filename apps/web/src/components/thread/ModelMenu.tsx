import type { Account, Harness } from "@runnerbox/contracts";
import { ChevronDownIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ComposerControl } from "../chat/ComposerControl";
import { Menu, MenuGroup, MenuGroupLabel, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuRadioItemIndicator, MenuSeparator, MenuTrigger } from "../ui/menu.tsx";

// A choice's label with its check, on one line, as T3 Code lays out its own menus.
const Choice = ({ children }: { children: ReactNode }) => (
  <span className="flex min-w-0 items-center gap-2">
    {children}
    <MenuRadioItemIndicator />
  </span>
);

// The default model, picked as no model at all, so the account's own setting decides.
const ACCOUNT_DEFAULT = "";

// What a turn runs on, in the composer's row: the harness and its model, then the account. Only
// Claude today; a second harness adds its own group of models here. With no models to list and
// one account, there's no choice to make, so there's no menu.
export function ModelMenu(props: {
  harnesses: ReadonlyArray<Harness>;
  accounts: ReadonlyArray<Account>;
  accountId: string | undefined;
  model: string | null;
  onAccount: (id: string) => void;
  onModel: (model: string | null) => void;
}) {
  const account = props.accounts.find((each) => each.id === props.accountId);
  const harness = props.harnesses.find((each) => each.driver === (account?.driver ?? "claude"));
  const picked = harness?.models.find((each) => each.id === props.model);
  if (props.harnesses.length === 0 && props.accounts.length < 2) return null;
  const label = harness ? `${harness.label} ${picked?.label ?? "default"}` : (account?.label ?? "Account");
  return (
    <Menu>
      <MenuTrigger render={<ComposerControl size="xs" aria-label="Harness, model and account" />}>
        <span data-composer-control-label>{label}</span>
        <ChevronDownIcon data-composer-control-chevron />
      </MenuTrigger>
      <MenuPopup side="top" align="end">
        {props.harnesses.map((each) => (
          <MenuGroup key={each.driver}>
            <MenuGroupLabel>{each.label}</MenuGroupLabel>
            <MenuRadioGroup value={props.model ?? ACCOUNT_DEFAULT} onValueChange={(value: string) => props.onModel(value === ACCOUNT_DEFAULT ? null : value)}>
              <MenuRadioItem value={ACCOUNT_DEFAULT} disabled={!each.status.available} closeOnClick>
                <Choice>{account?.model ? `Account's model (${account.model})` : "Account's default"}</Choice>
              </MenuRadioItem>
              {each.models.map((model) => (
                <MenuRadioItem key={model.id} value={model.id} disabled={!each.status.available} closeOnClick>
                  <Choice>{model.label}</Choice>
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuGroup>
        ))}
        {props.accounts.length > 1 ? (
          <>
            <MenuSeparator />
            <MenuGroup>
              <MenuGroupLabel>Account</MenuGroupLabel>
              <MenuRadioGroup value={props.accountId ?? ""} onValueChange={(value: string) => props.onAccount(value)}>
                {props.accounts.map((each) => (
                  <MenuRadioItem key={each.id} value={each.id} closeOnClick>
                    <Choice>{each.label}</Choice>
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuGroup>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}

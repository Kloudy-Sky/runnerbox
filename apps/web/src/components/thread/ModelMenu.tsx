import type { Provider, ProviderAccount } from "@runnerbox/contracts";
import { ChevronDownIcon } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { ComposerControl } from "../chat/ComposerControl";
import { Menu, MenuGroup, MenuGroupLabel, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuRadioItemIndicator, MenuSeparator, MenuTrigger } from "../ui/menu.tsx";

// A choice's label with its check, on one line, as T3 Code lays out its own menus.
const Choice = ({ children }: { children: ReactNode }) => (
  <span className="flex min-w-0 items-center gap-2">
    {children}
    <MenuRadioItemIndicator />
  </span>
);

// One radio group spans every driver, so a model is picked with its driver: each value is both.
// The empty model is the account's own setting.
const choiceOf = (driver: string, model: string | null) => `${driver}\u0000${model ?? ""}`;
const parseChoice = (value: string) => {
  const [driver = "", model = ""] = value.split("\u0000");
  return { driver, model: model === "" ? null : model };
};

// What a turn runs on, in the composer's row: each driver the server runs, with its models and, when
// it has more than one, its accounts under it. A driver's models and accounts show only under it.
// With no models to list and one account, there's no choice to make, so there's no menu.
export function ModelMenu(props: {
  providers: ReadonlyArray<Provider>;
  account: ProviderAccount | undefined;
  model: string | null;
  onModel: (driver: string, model: string | null) => void;
  onAccount: (account: ProviderAccount) => void;
}) {
  const accounts = props.providers.flatMap((provider) => provider.accounts);
  if (props.providers.every((provider) => provider.models.length === 0) && accounts.length < 2) return null;
  const driver = props.account?.driver ?? "claude";
  const provider = props.providers.find((each) => each.driver === driver);
  const picked = provider?.models.find((each) => each.id === props.model);
  const label = provider ? `${provider.label} ${picked?.label ?? "default"}` : (props.account?.label ?? "Account");
  return (
    <Menu>
      <MenuTrigger render={<ComposerControl size="xs" aria-label="Harness, model and account" />}>
        <span data-composer-control-label>{label}</span>
        <ChevronDownIcon data-composer-control-chevron />
      </MenuTrigger>
      <MenuPopup side="top" align="end">
        {props.providers.map((each, index) => {
          const own = props.account?.driver === each.driver ? props.account : undefined;
          // A model needs an account on its driver to run as.
          const usable = each.status.available && each.accounts.length > 0;
          return (
            <Fragment key={each.driver}>
              {index > 0 ? <MenuSeparator /> : null}
              <MenuGroup>
                <MenuGroupLabel>{each.label}</MenuGroupLabel>
                {each.models.length > 0 ? (
                  <MenuRadioGroup
                    value={choiceOf(driver, props.model)}
                    onValueChange={(value: string) => {
                      const next = parseChoice(value);
                      props.onModel(next.driver, next.model);
                    }}
                  >
                    <MenuRadioItem value={choiceOf(each.driver, null)} disabled={!usable} closeOnClick>
                      <Choice>{own?.model ? `Account's model (${own.model})` : "Account's default"}</Choice>
                    </MenuRadioItem>
                    {each.models.map((model) => (
                      <MenuRadioItem key={model.id} value={choiceOf(each.driver, model.id)} disabled={!usable} closeOnClick>
                        <Choice>{model.label}</Choice>
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                ) : null}
                {accounts.length > 1 && each.accounts.length > 0 ? (
                  <>
                  {each.models.length > 0 ? <MenuGroupLabel>Account</MenuGroupLabel> : null}
                  <MenuRadioGroup
                    value={props.account?.id ?? ""}
                    onValueChange={(value: string) => {
                      const next = each.accounts.find((account) => account.id === value);
                      if (next) props.onAccount(next);
                    }}
                  >
                    {each.accounts.map((account) => (
                      <MenuRadioItem key={account.id} value={account.id} closeOnClick>
                        <Choice>{account.label}</Choice>
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                  </>
                ) : null}
              </MenuGroup>
            </Fragment>
          );
        })}
      </MenuPopup>
    </Menu>
  );
}

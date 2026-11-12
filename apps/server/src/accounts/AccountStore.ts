import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { type Account, AccountError, BUILT_IN_ACCOUNT_ID, ProviderDriver, type SaveAccount } from "@runnerbox/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { writeFileAtomic } from "../config/atomicWrite.ts";
import * as ServerPaths from "../config/ServerPaths.ts";
import { Drivers } from "../threads/provider/Drivers.ts";
import type { TurnAccount } from "../threads/provider/ProviderAdapter.ts";

// The accounts agent turns can run as, in `.server/accounts.json`, owner-only. A key is written
// here and read back only to start a turn with it: it's never returned over RPC, logged, or put in
// a thread's log, and clients see only its last four characters.

const StoredAccount = Schema.Struct({
  id: Schema.String,
  driver: ProviderDriver,
  label: Schema.String,
  model: Schema.NullOr(Schema.String),
  apiKey: Schema.NullOr(Schema.String),
});
type StoredAccount = typeof StoredAccount.Type;
const AccountsFile = Schema.Struct({
  v: Schema.Literal(1),
  defaultId: Schema.String,
  // The built-in subscription account isn't stored, but its model can be changed.
  builtInModel: Schema.NullOr(Schema.String),
  accounts: Schema.Array(StoredAccount),
});
type AccountsFile = typeof AccountsFile.Type;
const decodeFile = Schema.decodeUnknownEffect(Schema.fromJsonString(AccountsFile));
const EMPTY: AccountsFile = { v: 1, defaultId: BUILT_IN_ACCOUNT_ID, builtInModel: null, accounts: [] };

const builtIn = (file: AccountsFile): StoredAccount => ({ id: BUILT_IN_ACCOUNT_ID, driver: "claude", label: "Claude, subscription", model: file.builtInModel, apiKey: null });
// The account a turn resolves to: the given ID, or the default, which falls back to the built-in
// when the default was removed.
export type ResolvedAccount = TurnAccount & { readonly id: string; readonly driver: ProviderDriver };

export class AccountStore extends Context.Service<
  AccountStore,
  {
    readonly list: Effect.Effect<ReadonlyArray<Account>, AccountError>;
    readonly save: (input: SaveAccount) => Effect.Effect<Account, AccountError>;
    readonly remove: (id: string) => Effect.Effect<void, AccountError>;
    readonly setDefault: (id: string) => Effect.Effect<void, AccountError>;
    readonly resolve: (id: string | undefined) => Effect.Effect<ResolvedAccount, AccountError>;
  }
>()("runnerbox/server/accounts/AccountStore") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const { serverDir } = yield* ServerPaths.ServerPaths;
  const drivers = yield* Drivers;
  const path = join(serverDir, "accounts.json");
  const lock = yield* Semaphore.make(1);
  const unreadable = () => new AccountError({ reason: "unreadable" });

  const read = fs.readFileString(path).pipe(
    Effect.catchTag("PlatformError", (error) => (error.reason._tag === "NotFound" ? Effect.succeed(null) : Effect.fail(error))),
    Effect.flatMap((text) => (text === null ? Effect.succeed(EMPTY) : decodeFile(text))),
    Effect.mapError(unreadable),
  );
  const write = (file: AccountsFile) =>
    fs.makeDirectory(serverDir, { recursive: true, mode: 0o700 }).pipe(
      Effect.andThen(writeFileAtomic(fs, path, `${JSON.stringify(file, null, 2)}\n`)),
      Effect.mapError(unreadable),
    );
  const update = <A>(change: (file: AccountsFile) => Effect.Effect<readonly [AccountsFile, A], AccountError>) =>
    lock.withPermits(1)(Effect.flatMap(read, change).pipe(Effect.tap(([file]) => write(file)), Effect.map(([, result]) => result)));

  const all = (file: AccountsFile) => [builtIn(file), ...file.accounts];
  const view = Effect.fn("AccountStore.view")(function* (file: AccountsFile, account: StoredAccount) {
    return {
      id: account.id,
      driver: account.driver,
      label: account.label,
      model: account.model,
      billing: account.apiKey === null ? ("subscription" as const) : ("api_key" as const),
      keyLast4: account.apiKey === null ? null : account.apiKey.slice(-4),
      isDefault: account.id === file.defaultId,
      builtIn: account.id === BUILT_IN_ACCOUNT_ID,
      status: yield* drivers.get(account.driver).status({ hasKey: account.apiKey !== null }),
    } satisfies Account;
  });

  const list = Effect.gen(function* () {
    const file = yield* read;
    return yield* Effect.forEach(all(file), (account) => view(file, account));
  });

  const save = Effect.fn("AccountStore.save")(function* (input: SaveAccount) {
    const saved = yield* update((file) => {
      if (input.id === BUILT_IN_ACCOUNT_ID) {
        if (input.apiKey !== undefined) return Effect.fail(new AccountError({ reason: "built_in" }));
        return Effect.succeed([{ ...file, builtInModel: input.model }, builtIn({ ...file, builtInModel: input.model })] as const);
      }
      const existing = input.id === undefined ? undefined : file.accounts.find((account) => account.id === input.id);
      if (input.id !== undefined && !existing) return Effect.fail(new AccountError({ reason: "not_found" }));
      const account: StoredAccount = {
        id: existing?.id ?? `account-${randomBytes(4).toString("hex")}`,
        driver: input.driver,
        label: input.label,
        model: input.model,
        apiKey: input.apiKey ?? existing?.apiKey ?? null,
      };
      const accounts = existing ? file.accounts.map((each) => (each.id === account.id ? account : each)) : [...file.accounts, account];
      return Effect.succeed([{ ...file, accounts }, account] as const);
    });
    return yield* view(yield* read, saved);
  });

  const remove = Effect.fn("AccountStore.remove")(function* (id: string) {
    yield* update((file) => {
      if (id === BUILT_IN_ACCOUNT_ID) return Effect.fail(new AccountError({ reason: "built_in" }));
      if (!file.accounts.some((account) => account.id === id)) return Effect.fail(new AccountError({ reason: "not_found" }));
      return Effect.succeed([{ ...file, accounts: file.accounts.filter((account) => account.id !== id), defaultId: file.defaultId === id ? BUILT_IN_ACCOUNT_ID : file.defaultId }, undefined] as const);
    });
  });

  const setDefault = Effect.fn("AccountStore.setDefault")(function* (id: string) {
    yield* update((file) =>
      all(file).some((account) => account.id === id) ? Effect.succeed([{ ...file, defaultId: id }, undefined] as const) : Effect.fail(new AccountError({ reason: "not_found" })),
    );
  });

  const resolve = Effect.fn("AccountStore.resolve")(function* (id: string | undefined) {
    const file = yield* read;
    const accounts = all(file);
    const found = id === undefined ? (accounts.find((account) => account.id === file.defaultId) ?? builtIn(file)) : accounts.find((account) => account.id === id);
    if (!found) return yield* new AccountError({ reason: "not_found" });
    return { id: found.id, driver: found.driver, label: found.label, model: found.model, apiKey: found.apiKey } satisfies ResolvedAccount;
  });

  return AccountStore.of({ list, save, remove, setDefault, resolve });
});

export const layer = Layer.effect(AccountStore, make);

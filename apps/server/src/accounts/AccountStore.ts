import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { type Account, AccountError, BUILT_IN_ACCOUNT_ID, ProviderDriver, type ProviderAccount, type SaveAccount } from "@runnerbox/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { writeFileAtomic } from "../config/atomicWrite.ts";
import * as ServerPaths from "../config/ServerPaths.ts";
import { Drivers } from "../threads/provider/Drivers.ts";
import { type Driver, HARNESSES } from "../threads/provider/harnesses.ts";
import type { TurnAccount } from "../threads/provider/ProviderAdapter.ts";

// The accounts agent turns can run as, owner-only under `.server`. Claude's are in `accounts.json`,
// as older servers read it; every other driver's are in `provider-accounts.json`, which they don't
// read, so going back to an older server hides them and loses nothing. A key is written here and
// read back only to start a turn with it: it's never returned over RPC, logged, or put in a
// thread's log, and clients see only its last four characters.

const OtherDriver = Schema.Literals(["codex"]);
const stored = <D extends Schema.Top>(driver: D) =>
  Schema.Struct({ id: Schema.String, driver, label: Schema.String, model: Schema.NullOr(Schema.String), apiKey: Schema.NullOr(Schema.String) });
const ClaudeAccount = stored(ProviderDriver);
const OtherAccount = stored(OtherDriver);
type StoredAccount = typeof ClaudeAccount.Type | typeof OtherAccount.Type;

const AccountsFile = Schema.Struct({
  v: Schema.Literal(1),
  // Any account's ID, in either file. An older server that can't find it uses the built-in one.
  defaultId: Schema.String,
  // The built-in subscription account isn't stored, but its model can be changed.
  builtInModel: Schema.NullOr(Schema.String),
  accounts: Schema.Array(ClaudeAccount),
});
type AccountsFile = typeof AccountsFile.Type;
const OthersFile = Schema.Struct({ v: Schema.Literal(1), accounts: Schema.Array(OtherAccount) });
type OthersFile = typeof OthersFile.Type;
const decodeFile = Schema.decodeUnknownEffect(Schema.fromJsonString(AccountsFile));
const decodeOthers = Schema.decodeUnknownEffect(Schema.fromJsonString(OthersFile));
const EMPTY: AccountsFile = { v: 1, defaultId: BUILT_IN_ACCOUNT_ID, builtInModel: null, accounts: [] };
const NO_OTHERS: OthersFile = { v: 1, accounts: [] };
type Files = { readonly claude: AccountsFile; readonly others: OthersFile };

const builtIn = (file: AccountsFile): typeof ClaudeAccount.Type => ({ id: BUILT_IN_ACCOUNT_ID, driver: "claude", label: "Claude, subscription", model: file.builtInModel, apiKey: null });
// The account a turn resolves to: the given ID, or the default, which falls back to the built-in
// when the default was removed or its driver doesn't run here.
export type ResolvedAccount = TurnAccount & { readonly id: string; readonly driver: Driver };
// Adds an account, or changes one when `id` is given, on any driver the store keeps.
export type SaveInput = { readonly id?: string; readonly driver: Driver; readonly label: string; readonly model: string | null; readonly apiKey?: string };

export class AccountStore extends Context.Service<
  AccountStore,
  {
    // Claude's accounts, as `accounts.list` gives them to older apps.
    readonly list: Effect.Effect<ReadonlyArray<Account>, AccountError>;
    // Every driver's.
    readonly listAll: Effect.Effect<ReadonlyArray<ProviderAccount>, AccountError>;
    // `accounts.save`, which only ever names Claude.
    readonly save: (input: SaveAccount) => Effect.Effect<Account, AccountError>;
    readonly saveAny: (input: SaveInput) => Effect.Effect<ProviderAccount, AccountError>;
    readonly remove: (id: string) => Effect.Effect<void, AccountError>;
    readonly setDefault: (id: string) => Effect.Effect<void, AccountError>;
    readonly resolve: (id: string | undefined) => Effect.Effect<ResolvedAccount, AccountError>;
  }
>()("runnerbox/server/accounts/AccountStore") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const { serverDir } = yield* ServerPaths.ServerPaths;
  const drivers = yield* Drivers;
  const claudePath = join(serverDir, "accounts.json");
  const othersPath = join(serverDir, "provider-accounts.json");
  const lock = yield* Semaphore.make(1);
  const unreadable = () => new AccountError({ reason: "unreadable" });

  const readText = (path: string) =>
    fs.readFileString(path).pipe(Effect.catchTag("PlatformError", (error) => (error.reason._tag === "NotFound" ? Effect.succeed(null) : Effect.fail(error))));
  const read = Effect.all({
    claude: readText(claudePath).pipe(Effect.flatMap((text) => (text === null ? Effect.succeed(EMPTY) : decodeFile(text)))),
    others: readText(othersPath).pipe(Effect.flatMap((text) => (text === null ? Effect.succeed(NO_OTHERS) : decodeOthers(text)))),
  }).pipe(Effect.mapError(unreadable));
  // Only a file that changed is written, so Claude-only servers never create the second file.
  const write = (before: Files, after: Files) =>
    fs.makeDirectory(serverDir, { recursive: true, mode: 0o700 }).pipe(
      Effect.andThen(before.claude === after.claude ? Effect.void : writeFileAtomic(fs, claudePath, `${JSON.stringify(after.claude, null, 2)}\n`)),
      Effect.andThen(before.others === after.others ? Effect.void : writeFileAtomic(fs, othersPath, `${JSON.stringify(after.others, null, 2)}\n`)),
      Effect.mapError(unreadable),
    );
  const update = <A>(change: (files: Files) => Effect.Effect<readonly [Files, A], AccountError>) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const before = yield* read;
        const [after, result] = yield* change(before);
        yield* write(before, after);
        return result;
      }),
    );

  // A key on a driver that takes none, such as one saved before Codex refused keys, is never used,
  // listed or kept: the account reads as signed in on the machine, and saving it drops the key.
  const keyOf = (account: StoredAccount) => (HARNESSES[account.driver].acceptsKeys ? account.apiKey : null);
  const claudeAccounts = (file: AccountsFile) => [builtIn(file), ...file.accounts];
  const all = (files: Files): ReadonlyArray<StoredAccount> => [...claudeAccounts(files.claude), ...files.others.accounts];
  // The default the owner set, unless it was removed or its driver doesn't run here: then the
  // built-in one, so a Codex default on a server without Codex doesn't stop every thread.
  const defaultOf = (files: Files) => {
    const set = all(files).find((account) => account.id === files.claude.defaultId);
    return set !== undefined && drivers.running.includes(set.driver) ? set : builtIn(files.claude);
  };
  const view = Effect.fn("AccountStore.view")(function* (files: Files, account: StoredAccount) {
    return {
      id: account.id,
      driver: account.driver,
      label: account.label,
      model: account.model,
      billing: keyOf(account) === null ? ("subscription" as const) : ("api_key" as const),
      keyLast4: keyOf(account)?.slice(-4) ?? null,
      isDefault: account.id === defaultOf(files).id,
      builtIn: account.id === BUILT_IN_ACCOUNT_ID,
      status: yield* drivers.get(account.driver).status({ hasKey: keyOf(account) !== null }),
    };
  });

  const list = Effect.gen(function* () {
    const files = yield* read;
    return yield* Effect.forEach(claudeAccounts(files.claude), (account) => view(files, account).pipe(Effect.map((viewed) => ({ ...viewed, driver: account.driver }))));
  });
  const listAll = Effect.gen(function* () {
    const files = yield* read;
    return yield* Effect.forEach(all(files), (account) => view(files, account));
  });

  const newId = () => `account-${randomBytes(4).toString("hex")}`;
  const saveAny = Effect.fn("AccountStore.saveAny")(function* (input: SaveInput) {
    const saved = yield* update((files): Effect.Effect<readonly [Files, StoredAccount], AccountError> => {
      if (input.id === BUILT_IN_ACCOUNT_ID) {
        if (input.apiKey !== undefined || input.driver !== "claude") return Effect.fail(new AccountError({ reason: "built_in" }));
        const claude = { ...files.claude, builtInModel: input.model };
        return Effect.succeed([{ ...files, claude }, builtIn(claude)] as const);
      }
      // An account keeps its driver: an ID on another driver's list isn't found.
      if (input.driver === "claude") {
        const existing = input.id === undefined ? undefined : files.claude.accounts.find((account) => account.id === input.id);
        if (input.id !== undefined && !existing) return Effect.fail(new AccountError({ reason: "not_found" }));
        const account = { id: existing?.id ?? newId(), driver: input.driver, label: input.label, model: input.model, apiKey: input.apiKey ?? existing?.apiKey ?? null };
        const accounts = existing ? files.claude.accounts.map((each) => (each.id === account.id ? account : each)) : [...files.claude.accounts, account];
        return Effect.succeed([{ ...files, claude: { ...files.claude, accounts } }, account] as const);
      }
      const existing = input.id === undefined ? undefined : files.others.accounts.find((account) => account.id === input.id && account.driver === input.driver);
      if (input.id !== undefined && !existing) return Effect.fail(new AccountError({ reason: "not_found" }));
      const account = { id: existing?.id ?? newId(), driver: input.driver, label: input.label, model: input.model, apiKey: HARNESSES[input.driver].acceptsKeys ? (input.apiKey ?? existing?.apiKey ?? null) : null };
      const accounts = existing ? files.others.accounts.map((each) => (each.id === account.id ? account : each)) : [...files.others.accounts, account];
      return Effect.succeed([{ ...files, others: { ...files.others, accounts } }, account] as const);
    });
    return yield* view(yield* read, saved);
  });

  const save = (input: SaveAccount) => saveAny(input).pipe(Effect.map((account) => ({ ...account, driver: input.driver })));

  const remove = Effect.fn("AccountStore.remove")(function* (id: string) {
    yield* update((files) => {
      if (id === BUILT_IN_ACCOUNT_ID) return Effect.fail(new AccountError({ reason: "built_in" }));
      if (!all(files).some((account) => account.id === id)) return Effect.fail(new AccountError({ reason: "not_found" }));
      const claude = {
        ...files.claude,
        accounts: files.claude.accounts.filter((account) => account.id !== id),
        defaultId: files.claude.defaultId === id ? BUILT_IN_ACCOUNT_ID : files.claude.defaultId,
      };
      const others = files.others.accounts.some((account) => account.id === id) ? { ...files.others, accounts: files.others.accounts.filter((account) => account.id !== id) } : files.others;
      return Effect.succeed([{ claude, others }, undefined] as const);
    });
  });

  const setDefault = Effect.fn("AccountStore.setDefault")(function* (id: string) {
    yield* update((files) =>
      all(files).some((account) => account.id === id)
        ? Effect.succeed([{ ...files, claude: { ...files.claude, defaultId: id } }, undefined] as const)
        : Effect.fail(new AccountError({ reason: "not_found" })),
    );
  });

  const resolve = Effect.fn("AccountStore.resolve")(function* (id: string | undefined) {
    const files = yield* read;
    const accounts = all(files);
    const found = id === undefined ? defaultOf(files) : accounts.find((account) => account.id === id);
    if (!found) return yield* new AccountError({ reason: "not_found" });
    return { id: found.id, driver: found.driver, label: found.label, model: found.model, apiKey: keyOf(found) } satisfies ResolvedAccount;
  });

  return AccountStore.of({ list, listAll, save, saveAny, remove, setDefault, resolve });
});

export const layer = Layer.effect(AccountStore, make);

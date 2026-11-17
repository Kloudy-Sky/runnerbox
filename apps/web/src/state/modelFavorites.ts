import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

// The models starred in the composer's picker, per environment, as account and model; a null model
// is the account's own setting. This client's own choice: nothing here goes to a server.
export type FavoriteModel = { readonly accountId: string; readonly model: string | null };

const same = (a: FavoriteModel, b: FavoriteModel) => a.accountId === b.accountId && a.model === b.model;

export const useModelFavorites = create<{
  readonly byEnvironment: Readonly<Record<string, ReadonlyArray<FavoriteModel>>>;
  readonly toggle: (environmentId: string, favorite: FavoriteModel) => void;
}>()(
  persist(
    (set) => ({
      byEnvironment: {},
      toggle: (environmentId, favorite) =>
        set(({ byEnvironment }) => {
          const current = byEnvironment[environmentId] ?? [];
          const next = current.some((each) => same(each, favorite)) ? current.filter((each) => !same(each, favorite)) : [...current, favorite];
          return { byEnvironment: { ...byEnvironment, [environmentId]: next } };
        }),
    }),
    { name: "runnerbox.model-favorites", storage: createJSONStorage(() => localStorage) },
  ),
);

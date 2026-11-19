import { AsyncResult, Atom } from "effect/reactivity";
import { answerOf } from "../lib/answer.ts";
import { environmentsAtom } from "./connections.ts";

// One atom per saved machine as a list, each answer beside the machine it came from, for a view
// that adds machines up. A machine that's offline keeps what it last answered.
export const everywhere = <A, E>(atomFor: (environmentId: string) => Atom.Atom<AsyncResult.AsyncResult<A, E>>) =>
  Atom.readable((get) => get(environmentsAtom).map((environment) => ({ environment, ...answerOf(get(atomFor(environment.environmentId))) })));

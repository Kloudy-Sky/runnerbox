import { RunnerboxRpcGroup, StateReadError } from "@runnerbox/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type { Session } from "../auth/AuthStore.ts";
import * as AuthStore from "../auth/AuthStore.ts";
import * as JobHistory from "../history/JobHistory.ts";
import type { LogReadError } from "../history/StateLogs.ts";
import * as Inbox from "../inbox/Inbox.ts";
import * as LauncherLogs from "../runners/LauncherLogs.ts";
import * as RunnerState from "../runners/RunnerState.ts";

const toWire = Effect.mapError((error: LogReadError) => new StateReadError({ what: error.what }));

// Each handler decodes nothing itself (the RPC layer did), calls one service method and maps its
// error to the wire's. Built per connection, since access methods act as that connection's session.
export const layer = (session: Session) =>
  RunnerboxRpcGroup.toLayer(
    Effect.gen(function* () {
      const history = yield* JobHistory.JobHistory;
      const launcher = yield* LauncherLogs.LauncherLogs;
      const runnerState = yield* RunnerState.RunnerState;
      const inbox = yield* Inbox.Inbox;
      const auth = yield* AuthStore.AuthStore;
      return {
        "history.repos": () => history.repos.pipe(toWire),
        "history.overview": ({ days }) => history.overview(days).pipe(toWire),
        "history.jobSummaries": (input) => history.jobSummaries(input).pipe(toWire),
        "history.stepComparison": (input) => history.stepComparison(input).pipe(toWire),
        "history.runs": (input) => history.runs(input).pipe(toWire),
        "history.weeklySummary": (input) => history.weeklySummary(input).pipe(toWire),
        "inbox.list": ({ days }) => inbox.list(days).pipe(toWire),
        "runners.events": ({ days }) => launcher.events(days).pipe(toWire),
        "runners.samples": ({ days, maxPoints }) => launcher.samples(days, maxPoints).pipe(toWire),
        "runners.state": () => runnerState.current.pipe(toWire),
        "runners.subscribeState": () => runnerState.changes.pipe(Stream.mapError((error) => new StateReadError({ what: error.what }))),
        "access.sessions": () => auth.list(session.id).pipe(Effect.orDie),
        "access.createPairingCode": ({ scopes }) =>
          auth.delegatePairingCode(session, scopes).pipe(Effect.catchTags({ AuthStoreError: Effect.die })),
        "access.revokeSession": ({ id }) =>
          auth.revoke(id).pipe(Effect.catchTags({ AuthStoreError: Effect.die })),
      };
    }),
  );

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
import * as Proposals from "../proposals/Proposals.ts";
import * as Threads from "../threads/Threads.ts";
import * as AccountStore from "../accounts/AccountStore.ts";
import * as EnvironmentIdentity from "../environment/EnvironmentIdentity.ts";

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
      const threads = yield* Threads.Threads;
      const proposals = yield* Proposals.Proposals;
      // Who approved, as `up` logs it: the session, never its token.
      const approver = { id: session.id, label: session.label };
      const accounts = yield* AccountStore.AccountStore;
      const identity = yield* EnvironmentIdentity.EnvironmentIdentity;
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
        "threads.provider": () => threads.provider,
        "threads.list": ({ subject }) => threads.list(subject),
        "threads.read": ({ id }) => threads.read(id),
        "threads.create": ({ subject, days }) => threads.create(subject, days),
        "threads.startTurn": ({ id, text, accountId }) => threads.startTurn(id, text, { accountId, scopes: session.scopes }),
        "threads.interrupt": ({ id }) => threads.interrupt(id),
        "threads.subscribe": ({ id }) => threads.subscribe(id),
        "threads.checkReproduce": ({ id }) => threads.checkReproduce(id),
        "threads.startReproduce": ({ id, network }) => threads.startReproduce(id, network),
        "threads.stopReproduce": ({ id }) => threads.stopReproduce(id),
        "proposals.list": () => proposals.list.pipe(Effect.map((all) => ({ proposals: all, canApprove: session.scopes.includes("changes:approve") }))),
        "proposals.approve": ({ id, hash, when }) => proposals.approve(id, hash, when, approver),
        "proposals.decline": ({ id }) => proposals.decline(id, approver),
        "proposals.revert": ({ id }) => proposals.revert(id, approver),
        "accounts.list": () => accounts.list,
        "accounts.save": (input) => accounts.save(input),
        "accounts.remove": ({ id }) => accounts.remove(id),
        "accounts.setDefault": ({ id }) => accounts.setDefault(id),
        "server.about": () => Effect.succeed({ label: identity.descriptor.label, serverVersion: identity.descriptor.serverVersion, protocolVersion: identity.descriptor.protocolVersion }),
      };
    }),
  );

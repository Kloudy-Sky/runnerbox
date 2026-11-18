import { RPC_METHODS, RPC_SCOPES, RunnerboxRpcGroup, StateReadError, type TurnRequest } from "@runnerbox/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type { Session } from "../auth/AuthStore.ts";
import * as AuthStore from "../auth/AuthStore.ts";
import * as DailyTotals from "../history/DailyTotals.ts";
import * as JobHistory from "../history/JobHistory.ts";
import type { LogReadError } from "../history/StateLogs.ts";
import * as Inbox from "../inbox/Inbox.ts";
import * as InboxState from "../inbox/InboxState.ts";
import * as LauncherLogs from "../runners/LauncherLogs.ts";
import * as RunnerQueue from "../runners/RunnerQueue.ts";
import * as RunnersExplained from "../runners/RunnersExplained.ts";
import * as RunnerState from "../runners/RunnerState.ts";
import * as DailyHealth from "../runners/DailyHealth.ts";
import * as Monitors from "../monitors/Monitors.ts";
import * as Proposals from "../proposals/Proposals.ts";
import * as GitHub from "../github/GitHub.ts";
import * as ReviewRuns from "../reviews/ReviewRuns.ts";
import * as Reviews from "../reviews/Reviews.ts";
import * as ReviewWatch from "../reviews/ReviewWatch.ts";
import * as Threads from "../threads/Threads.ts";
import * as AccountStore from "../accounts/AccountStore.ts";
import * as Providers from "../accounts/Providers.ts";
import * as Attachments from "../attachments/Attachments.ts";
import * as EnvironmentIdentity from "../environment/EnvironmentIdentity.ts";
import * as RunnerRestarts from "../runners/RunnerRestarts.ts";
import * as ServerUpdate from "../update/ServerUpdate.ts";

const toWire = Effect.mapError((error: LogReadError) => new StateReadError({ what: error.what }));

// Each handler decodes nothing itself (the RPC layer did), calls one service method and maps its
// error to the wire's. Built per connection, since access methods act as that connection's session.
// Every method this build answers, less any a test server leaves out to act as an older build.
export const layer = (session: Session, answered: ReadonlyArray<string> = Object.values(RPC_METHODS)) =>
  RunnerboxRpcGroup.toLayer(
    Effect.gen(function* () {
      const history = yield* JobHistory.JobHistory;
      const dailyTotals = yield* DailyTotals.DailyTotals;
      const launcher = yield* LauncherLogs.LauncherLogs;
      const runnerState = yield* RunnerState.RunnerState;
      const queue = yield* RunnerQueue.RunnerQueue;
      const explained = yield* RunnersExplained.RunnersExplained;
      const health = yield* DailyHealth.DailyHealth;
      const inbox = yield* Inbox.Inbox;
      const inboxState = yield* InboxState.InboxState;
      const auth = yield* AuthStore.AuthStore;
      const threads = yield* Threads.Threads;
      const proposals = yield* Proposals.Proposals;
      const monitors = yield* Monitors.Monitors;
      // The same scopes the server checks on monitors.save, so the switch is never offered when saving would be refused.
      const canConfigureMonitors = RPC_SCOPES[RPC_METHODS.monitorsSave].every((scope) => session.scopes.includes(scope));
      const github = yield* GitHub.GitHub;
      const reviews = yield* Reviews.Reviews;
      const reviewRuns = yield* ReviewRuns.ReviewRuns;
      const reviewWatch = yield* ReviewWatch.ReviewWatch;
      // The same scopes the server checks on reviews.setRepo and reviews.start, so a switch or a button is never offered when it would be refused.
      const mayReview = {
        configure: RPC_SCOPES[RPC_METHODS.reviewsSetRepo].every((scope) => session.scopes.includes(scope)),
        review: RPC_SCOPES[RPC_METHODS.reviewsStart].every((scope) => session.scopes.includes(scope)),
      };
      // Who approved, as `up` logs it: the session, never its token.
      const approver = { id: session.id, label: session.label };
      const accounts = yield* AccountStore.AccountStore;
      const providers = yield* Providers.Providers;
      const attachments = yield* Attachments.Attachments;
      const identity = yield* EnvironmentIdentity.EnvironmentIdentity;
      const serverUpdate = yield* ServerUpdate.ServerUpdate;
      const restarts = yield* RunnerRestarts.RunnerRestarts;
      // A turn's files are the ones this session staged, and its tools follow this session's scopes.
      const turnOptions = ({ attachments: ids, ...rest }: Omit<TurnRequest, "id" | "text">): Threads.TurnOptions => ({
        ...rest,
        attachments: ids ? { sessionId: session.id, ids } : undefined,
        scopes: session.scopes,
      });
      return {
        "history.repos": () => history.repos.pipe(toWire),
        "history.overview": ({ days }) => history.overview(days).pipe(toWire),
        "history.jobSummaries": (input) => history.jobSummaries(input).pipe(toWire),
        "history.stepComparison": (input) => history.stepComparison(input).pipe(toWire),
        "history.runs": (input) => history.runs(input).pipe(toWire),
        "history.weeklySummary": (input) => history.weeklySummary(input).pipe(toWire),
        "history.kindUsage": ({ days }) => history.kindUsage(days).pipe(toWire),
        "history.jobTrends": (input) => history.jobTrends(input).pipe(toWire),
        "history.dailyTotals": ({ days, repo }) =>
          dailyTotals.days(days, repo).pipe(Effect.mapError((error) => new StateReadError({ what: error._tag === "ReviewError" ? "reviews" : error.what }))),
        "history.jobResources": (input) =>
          history.jobResources(input).pipe(Effect.mapError((error) => new StateReadError({ what: error._tag === "JobNotFound" ? `job ${error.jobId}` : error.what }))),
        "inbox.list": ({ days }) => inbox.list(days).pipe(toWire),
        "inbox.settle": ({ id }) => inboxState.settle(id),
        "inbox.unsettle": ({ id }) => inboxState.unsettle(id),
        "inbox.snooze": ({ id, until }) => inboxState.snooze(id, until),
        "inbox.wake": ({ id }) => inboxState.wake(id),
        "runners.events": ({ days }) => launcher.events(days).pipe(toWire),
        "runners.samples": ({ days, maxPoints }) => launcher.samples(days, maxPoints).pipe(toWire),
        "runners.state": () => runnerState.current.pipe(toWire),
        "runners.explain": ({ days }) => explained.explain(days).pipe(toWire),
        "runners.health": ({ days }) => health.report(days).pipe(toWire),
        "runners.subscribeState": () => runnerState.changes.pipe(Stream.mapError((error) => new StateReadError({ what: error.what }))),
        "runners.subscribeQueue": () => queue.changes,
        "access.sessions": () => auth.list(session.id).pipe(Effect.orDie),
        "access.createPairingCode": ({ scopes }) =>
          auth.delegatePairingCode(session, scopes).pipe(Effect.catchTags({ AuthStoreError: Effect.die })),
        "access.revokeSession": ({ id }) =>
          auth.revoke(id).pipe(Effect.catchTags({ AuthStoreError: Effect.die })),
        "threads.provider": () => threads.provider,
        "threads.list": ({ subject }) => threads.list(subject),
        "threads.read": ({ id }) => threads.read(id),
        "threads.create": ({ subject, days }) => threads.create(subject, days),
        "threads.harnesses": () => threads.harnesses,
        "threads.startTurn": ({ id, text, ...rest }) => threads.startTurn(id, text, turnOptions(rest)),
        "threads.queueTurn": ({ id, text, ...rest }) => threads.queueTurn(id, text, turnOptions(rest)),
        "threads.cancelQueued": ({ id }) => threads.cancelQueued(id),
        "threads.delete": ({ id }) => threads.remove(id),
        "threads.stageAttachment": (file) => attachments.stage(session.id, file),
        "threads.attachmentChunk": (chunk) => attachments.chunk(session.id, chunk),
        "threads.discardAttachment": ({ id }) => attachments.discard(session.id, id),
        "threads.attachment": ({ threadId, id }) => attachments.stream(threadId, id),
        "threads.interrupt": ({ id }) => threads.interrupt(id),
        "threads.subscribe": ({ id }) => threads.subscribe(id),
        "threads.checkReproduce": ({ id }) => threads.checkReproduce(id),
        "threads.startReproduce": ({ id, network }) => threads.startReproduce(id, network),
        "threads.stopReproduce": ({ id }) => threads.stopReproduce(id),
        "proposals.list": () => proposals.list.pipe(Effect.map((all) => ({ proposals: all, canApprove: session.scopes.includes("changes:approve") }))),
        "proposals.approve": ({ id, hash, when }) => proposals.approve(id, hash, when, approver),
        "proposals.decline": ({ id }) => proposals.decline(id, approver),
        "proposals.revert": ({ id }) => proposals.revert(id, approver),
        "monitors.status": () => monitors.status(canConfigureMonitors),
        "monitors.save": (settings) => monitors.save(settings),
        "monitors.markRead": ({ itemId }) => monitors.markRead(itemId),
        "reviews.status": () => reviewWatch.status(mayReview),
        "github.status": () => github.status(mayReview),
        "github.signIn": () => github.signIn(mayReview),
        "github.cancelSignIn": () => github.cancelSignIn(mayReview),
        "github.signOut": () => github.signOut(mayReview),
        "reviews.setRepo": ({ repo, review }) => reviews.setRepo(repo, review, mayReview),
        "reviews.setModel": ({ model }) => reviews.setModel(model, mayReview),
        "reviews.read": ({ repo, number }) => reviewRuns.read(repo, number, mayReview.review),
        "reviews.start": ({ repo, number }) => reviewRuns.start(repo, number),
        "reviews.stop": ({ repo, number }) => reviewRuns.stop(repo, number),
        "accounts.list": () => accounts.list,
        "accounts.save": (input) => accounts.save(input),
        "accounts.remove": ({ id }) => accounts.remove(id),
        "accounts.setDefault": ({ id }) => accounts.setDefault(id),
        "providers.list": () => providers.list,
        "providers.save": (input) => providers.save(input),
        "server.methods": () => Effect.succeed(answered),
        "server.about": () => Effect.succeed({ label: identity.descriptor.label, serverVersion: identity.descriptor.serverVersion, protocolVersion: identity.descriptor.protocolVersion }),
        "server.updateStatus": () => serverUpdate.status,
        "server.update": ({ version }) => serverUpdate.update(version),
        "server.checkRelease": ({ version }) => serverUpdate.checkRelease(version),
        "runners.restartStatus": ({ install }) => restarts.status(install),
        // Who asked, as `up` logs it: the session, never its token.
        "runners.restartWhenIdle": ({ install }) => restarts.restartWhenIdle(install, { session: session.id, label: session.label }),
      };
    }),
  );

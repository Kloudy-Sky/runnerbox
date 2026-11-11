import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { createStore } from "zustand/vanilla";
import type { ClientPlatform, Route, SavedEnvironment, SshRoute } from "./environments.ts";
import { ConnectionError, fetchDescriptor, pairWithCode, type ProveRequest } from "./http.ts";
import { openSession, type RunnerboxClient } from "./session.ts";

export type ConnectionState =
  | { readonly status: "connecting"; readonly attempt: number }
  | { readonly status: "connected"; readonly client: RunnerboxClient; readonly since: number; readonly route: Route }
  | { readonly status: "disconnected"; readonly reason: ConnectionError["reason"]; readonly message: string; readonly retryAt: number | null };

export type ClientState = {
  readonly loaded: boolean;
  readonly environments: ReadonlyArray<SavedEnvironment>;
  readonly connections: Readonly<Record<string, ConnectionState>>;
};

// Seconds before each retry: quick at first, then every 15 seconds while the server stays away.
const BACKOFF_SECONDS = [1, 2, 5, 10, 15];
// These won't fix themselves by retrying, so the connection waits for the user.
const FINAL: ReadonlySet<ConnectionError["reason"]> = new Set(["unauthorized", "incompatible", "wrong_environment"]);

const asConnectionError = (error: unknown) =>
  error instanceof ConnectionError ? error : new ConnectionError({ reason: "unreachable", cause: error });

// Saved environments and one live connection to each. Reconnects on its own with backoff, and
// before sending a token checks that the address still answers as the environment it was paired
// with, so a reused address never receives another machine's credential.
export function createClientRuntime(platform: ClientPlatform) {
  const store = createStore<ClientState>(() => ({ loaded: false, environments: [], connections: {} }));
  const loops = new Map<string, Fiber.Fiber<unknown, unknown>>();

  const setConnection = (environmentId: string, state: ConnectionState) =>
    store.setState((current) => ({ connections: { ...current.connections, [environmentId]: state } }));

  const tunnel = (route: SshRoute) =>
    platform.ssh
      ? Effect.tryPromise({ try: () => platform.ssh!.openTunnel(route), catch: (cause) => new ConnectionError({ reason: "tunnel_failed", cause }) })
      : Effect.fail(new ConnectionError({ reason: "tunnel_failed", cause: new Error("SSH routes need the desktop app") }));

  const baseUrlFor = (route: Exclude<Route, { kind: "connect" }>) =>
    route.kind === "direct" ? Effect.succeed(route.url) : tunnel(route).pipe(Effect.map(({ baseUrl }) => baseUrl));

  // The address to use and how to authenticate there. Over Connect that's a fresh session: a new
  // proof key, a credential from the relay bound to it, and a pairing that proves the key.
  const sessionFor = (environment: SavedEnvironment, route: Route) =>
    Effect.gen(function* () {
      if (route.kind !== "connect") {
        if (environment.token === null) return yield* new ConnectionError({ reason: "unauthorized" });
        return { baseUrl: yield* baseUrlFor(route), token: environment.token, prove: undefined };
      }
      const connect = platform.connect;
      if (!connect) return yield* new ConnectionError({ reason: "relay_refused", cause: new Error("Connect routes need the desktop app") });
      const key = yield* Effect.tryPromise({ try: () => connect.createProofKey(), catch: (cause) => new ConnectionError({ reason: "relay_refused", cause }) });
      const prove: ProveRequest = (request) => connect.prove(key.keyId, request);
      const granted = yield* Effect.tryPromise({
        try: () => connect.requestCredential(environment.environmentId, key.thumbprint),
        catch: (cause) => new ConnectionError({ reason: "relay_refused", cause }),
      });
      const paired = yield* pairWithCode(granted.httpBaseUrl, granted.credential, "connect", prove);
      return { baseUrl: granted.httpBaseUrl, token: paired.token, prove };
    });

  // Walks the routes in order and keeps the first that connects. An incompatible server stops the
  // walk, since it's the same server on every route.
  const connectOnce = (environment: SavedEnvironment) =>
    Effect.gen(function* () {
      let last = new ConnectionError({ reason: "unreachable" });
      for (const route of environment.routes) {
        const attempt = yield* Effect.exit(
          Effect.scoped(
            Effect.gen(function* () {
              const { baseUrl, token, prove } = yield* sessionFor(environment, route);
              const descriptor = yield* fetchDescriptor(baseUrl);
              if (descriptor.environmentId !== environment.environmentId) return yield* new ConnectionError({ reason: "wrong_environment" });
              const { client, closed } = yield* openSession(baseUrl, token, prove);
              setConnection(environment.environmentId, { status: "connected", client, since: Date.now(), route });
              yield* closed;
            }),
          ),
        );
        // A session that ran and then closed ends the walk; the loop starts it again from the top.
        if (Exit.isSuccess(attempt)) return yield* new ConnectionError({ reason: "unreachable" });
        last = asConnectionError(Cause.squash(attempt.cause));
        if (last.reason === "incompatible") break;
      }
      return yield* last;
    });

  const loop = (environment: SavedEnvironment) =>
    Effect.gen(function* () {
      for (let attempt = 0; ; attempt++) {
        setConnection(environment.environmentId, { status: "connecting", attempt });
        const exit = yield* Effect.exit(connectOnce(environment));
        // A session that ends without an error is a dropped socket.
        const error = Exit.isFailure(exit) ? asConnectionError(Cause.squash(exit.cause)) : new ConnectionError({ reason: "unreachable" });
        // A session that was up starts the backoff over.
        if (store.getState().connections[environment.environmentId]?.status === "connected") attempt = 0;
        const final = FINAL.has(error.reason);
        const delay = BACKOFF_SECONDS[Math.min(attempt, BACKOFF_SECONDS.length - 1)]!;
        setConnection(environment.environmentId, {
          status: "disconnected",
          reason: error.reason,
          message: error.message,
          retryAt: final ? null : Date.now() + delay * 1000,
        });
        if (final) return;
        yield* Effect.sleep(Duration.seconds(delay));
      }
    });

  const start = (environment: SavedEnvironment) => {
    const running = loops.get(environment.environmentId);
    if (running) Effect.runFork(Fiber.interrupt(running));
    loops.set(environment.environmentId, Effect.runFork(loop(environment)));
  };

  const stop = (environmentId: string) => {
    const running = loops.get(environmentId);
    loops.delete(environmentId);
    if (running) Effect.runFork(Fiber.interrupt(running));
  };

  const save = async (environment: SavedEnvironment) => {
    await platform.catalog.save(environment);
    store.setState((current) => ({
      environments: [...current.environments.filter((saved) => saved.environmentId !== environment.environmentId), environment],
    }));
    start(environment);
    return environment;
  };

  const pair = (route: Exclude<Route, { kind: "connect" }>, code: string, label: string) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const baseUrl = yield* baseUrlFor(route);
        const descriptor = yield* fetchDescriptor(baseUrl);
        const paired = yield* pairWithCode(baseUrl, code, label);
        return {
          environmentId: paired.environmentId,
          label: descriptor.label,
          routes: [route],
          token: paired.token,
          scopes: paired.scopes,
          pairedAt: new Date().toISOString(),
        } satisfies SavedEnvironment;
      }),
    ).then(save);

  return {
    store,
    canUseSsh: platform.ssh !== undefined,
    connect: platform.connect,

    // Adds a Connect route to an environment, after any routes it already has, or saves a new
    // environment reachable only through Connect, which reads and nothing more.
    addConnectRoute(linked: { environmentId: string; label: string }, relayUrl: string) {
      const route: Route = { kind: "connect", relayUrl };
      const existing = store.getState().environments.find((saved) => saved.environmentId === linked.environmentId);
      if (existing?.routes.some((other) => other.kind === "connect")) return Promise.resolve(existing);
      return save(
        existing
          ? { ...existing, routes: [...existing.routes, route] }
          : { environmentId: linked.environmentId, label: linked.label, routes: [route], token: null, scopes: ["history:read", "runners:read"], pairedAt: new Date().toISOString() },
      );
    },

    async load() {
      const environments = await platform.catalog.list();
      store.setState({ loaded: true, environments });
      environments.forEach(start);
    },

    pairDirect: (url: string, code: string, label: string) => pair({ kind: "direct", url }, code, label),

    // With no code, fetches one by running the server's `pair` command over SSH.
    async pairSsh(route: SshRoute, code: string | null, label: string) {
      const fetched = code ?? (await platform.ssh!.fetchPairingCode(route)).code;
      return pair(route, fetched, label);
    },

    async remove(environmentId: string) {
      const environment = store.getState().environments.find((saved) => saved.environmentId === environmentId);
      stop(environmentId);
      await platform.catalog.remove(environmentId);
      for (const route of environment?.routes ?? []) if (route.kind === "ssh") await platform.ssh?.closeTunnel(route);
      store.setState((current) => {
        const { [environmentId]: _removed, ...connections } = current.connections;
        return { environments: current.environments.filter((saved) => saved.environmentId !== environmentId), connections };
      });
    },

    reconnect(environmentId: string) {
      const environment = store.getState().environments.find((saved) => saved.environmentId === environmentId);
      if (environment) start(environment);
    },

    // Runs one call on an environment's live connection.
    run<A, E>(environmentId: string, call: (client: RunnerboxClient) => Effect.Effect<A, E>) {
      const connection = store.getState().connections[environmentId];
      if (connection?.status !== "connected") return Promise.reject(new ConnectionError({ reason: "unreachable" }));
      return Effect.runPromise(call(connection.client));
    },

    // Follows a stream on an environment's live connection until the returned function is called.
    follow<A, E>(environmentId: string, open: (client: RunnerboxClient) => Stream.Stream<A, E>, onValue: (value: A) => void) {
      const connection = store.getState().connections[environmentId];
      if (connection?.status !== "connected") return () => {};
      const fiber = Effect.runFork(Stream.runForEach(open(connection.client), (value) => Effect.sync(() => onValue(value))));
      return () => void Effect.runFork(Fiber.interrupt(fiber));
    },
  };
}

export type ClientRuntime = ReturnType<typeof createClientRuntime>;

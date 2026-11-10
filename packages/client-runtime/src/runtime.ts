import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { createStore } from "zustand/vanilla";
import type { ClientPlatform, Route, SavedEnvironment, SshRoute } from "./environments.ts";
import { ConnectionError, fetchDescriptor, pairWithCode } from "./http.ts";
import { openSession, type RunnerboxClient } from "./session.ts";

export type ConnectionState =
  | { readonly status: "connecting"; readonly attempt: number }
  | { readonly status: "connected"; readonly client: RunnerboxClient; readonly since: number }
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

  const baseUrlFor = (route: Route) => (route.kind === "direct" ? Effect.succeed(route.url) : tunnel(route).pipe(Effect.map(({ baseUrl }) => baseUrl)));

  const connectOnce = (environment: SavedEnvironment) =>
    Effect.scoped(
      Effect.gen(function* () {
        const baseUrl = yield* baseUrlFor(environment.route);
        const descriptor = yield* fetchDescriptor(baseUrl);
        if (descriptor.environmentId !== environment.environmentId) return yield* new ConnectionError({ reason: "wrong_environment" });
        const { client, closed } = yield* openSession(baseUrl, environment.token);
        setConnection(environment.environmentId, { status: "connected", client, since: Date.now() });
        yield* closed;
      }),
    );

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

  const pair = (route: Route, code: string, label: string) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const baseUrl = yield* baseUrlFor(route);
        const descriptor = yield* fetchDescriptor(baseUrl);
        const paired = yield* pairWithCode(baseUrl, code, label);
        return {
          environmentId: paired.environmentId,
          label: descriptor.label,
          route,
          token: paired.token,
          scopes: paired.scopes,
          pairedAt: new Date().toISOString(),
        } satisfies SavedEnvironment;
      }),
    ).then(save);

  return {
    store,
    canUseSsh: platform.ssh !== undefined,

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
      if (environment?.route.kind === "ssh") await platform.ssh?.closeTunnel(environment.route);
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

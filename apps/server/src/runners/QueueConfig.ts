import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import { GITHUB_API } from "runnerbox/src/github/github-client.ts";
import { reportEnvPath } from "../github/reportToken.ts";

export type QueueTiming = {
  // Between polls while someone watches, and while the token's budget is short.
  readonly pollMs: number;
  readonly slowMs: number;
  // The longest wait between tries after errors.
  readonly maxBackoffMs: number;
  // How long polling goes on after the last watcher leaves, and how often an idle poller looks again.
  readonly idleMs: number;
  readonly checkMs: number;
};

// Where the queue poll reads its token and sends its requests, and its pace. `serve` always uses
// GitHub's API host and the report timer's file. Only tests build it any other way.
export class QueueConfig extends Context.Service<QueueConfig, { readonly apiBase: string; readonly reportEnvPath: string; readonly timing: QueueTiming }>()(
  "runnerbox/server/QueueConfig",
) {}

export const layer = Layer.sync(QueueConfig, () =>
  QueueConfig.of({
    apiBase: GITHUB_API,
    reportEnvPath: reportEnvPath(),
    timing: { pollMs: 20_000, slowMs: 120_000, maxBackoffMs: 300_000, idleMs: 60_000, checkMs: 1_000 },
  }),
);

export const layerTest = (config: QueueConfig["Service"]) => Layer.succeed(QueueConfig, QueueConfig.of(config));

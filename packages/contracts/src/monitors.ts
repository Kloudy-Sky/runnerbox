import * as Schema from "effect/Schema";
import { AccountId } from "./accounts.ts";

// A monitor: the agent looking into each new problem in the inbox on its own, and leaving what it
// found in that item's thread. Off by default, read-only, and at most `dailyLimit` looks a day.

export const MAX_DAILY_LIMIT = 20;
export const DEFAULT_DAILY_LIMIT = 5;
export const DEFAULT_MONITOR_MODEL = "haiku";

export const MonitorSettings = Schema.Struct({
  enabled: Schema.Boolean,
  dailyLimit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: MAX_DAILY_LIMIT })),
  // Null runs as the default account.
  accountId: Schema.NullOr(AccountId),
  // Null runs on Haiku.
  model: Schema.NullOr(Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._:-]{1,80}$/))),
});
export type MonitorSettings = typeof MonitorSettings.Type;

export const MonitorRun = Schema.Struct({
  itemId: Schema.String,
  title: Schema.String,
  threadId: Schema.String,
  startedAt: Schema.String,
  outcome: Schema.Literals(["running", "completed", "failed", "interrupted"]),
  costUsd: Schema.NullOr(Schema.Number),
});
export type MonitorRun = typeof MonitorRun.Type;

export const MonitorStatus = Schema.Struct({
  settings: MonitorSettings,
  // Today on the server's clock: looks started, their estimated cost, and new items skipped at the limit.
  today: Schema.Struct({ looks: Schema.Int, costUsd: Schema.Number, skipped: Schema.Int }),
  runs: Schema.Array(MonitorRun),
  // Items a monitor looked into whose thread the owner hasn't opened since.
  unread: Schema.Array(Schema.String),
  // Whether this session may change the settings.
  canConfigure: Schema.Boolean,
});
export type MonitorStatus = typeof MonitorStatus.Type;

export class MonitorError extends Schema.TaggedError<MonitorError>()("MonitorError", { why: Schema.String }) {
  override get message() {
    return this.why;
  }
}

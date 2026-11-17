import * as Schema from "effect/Schema";

// Whether a machine took jobs on a day. `up`: all day. `partial`: some of the day, and off the rest,
// as a laptop's working day. `down`: reporting for half an hour or more with no runner online, as
// runners failing, backing off or waiting. `off`: not running or not reporting at all, as a laptop
// at night, which is normal and not a fault.
export const DayUptime = Schema.Literals(["up", "partial", "down", "off"]);
export type DayUptime = typeof DayUptime.Type;

// One install on one day of the host's own calendar, so a laptop's nights fall inside one day.
export const HealthDay = Schema.Struct({
  day: Schema.String,
  uptime: DayUptime,
  // The minutes behind `uptime`. Today counts only the minutes so far.
  upMinutes: Schema.Number,
  downMinutes: Schema.Number,
  offMinutes: Schema.Number,
  // The least memory available in the VM in any sample that day. Null with no VM reading.
  lowestVmFreeMiB: Schema.NullOr(Schema.Number),
  // Jobs its runners finished, from the job log.
  jobsTaken: Schema.Number,
  // Runners that exited with an error within a minute, before any job reached them.
  failedBeforeJob: Schema.Number,
  // Failed jobs the history judged the machine's fault, the `infra` verdict.
  failedByMachine: Schema.Number,
});
export type HealthDay = typeof HealthDay.Type;

export const MachineHealth = Schema.Struct({
  install: Schema.String,
  // The VM memory runners wait for before registering, from the install's live state. Null when
  // it has no VM or hasn't said.
  pauseBelowMiB: Schema.NullOr(Schema.Number),
  // Oldest first, one per day of the range.
  days: Schema.Array(HealthDay),
});
export type MachineHealth = typeof MachineHealth.Type;

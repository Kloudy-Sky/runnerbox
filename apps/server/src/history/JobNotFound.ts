import * as Schema from "effect/Schema";

// The repo's job log, over the longest window the app asks for, has no job with this ID.
export class JobNotFound extends Schema.TaggedError<JobNotFound>()("JobNotFound", { jobId: Schema.Number }) {
  override get message() {
    return `No job ${this.jobId} in the last 90 days of this repository's log.`;
  }
}

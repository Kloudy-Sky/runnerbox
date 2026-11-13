// What each of the agent's read-only tools did, said plainly for the thread. The raw call stays a
// click away.
const PHRASES: Record<string, string> = {
  list_repos: "Listed the repositories",
  ci_inbox: "Read the inbox",
  ci_overview: "Read the totals for the period",
  job_summaries: "Read each job's times and failures",
  step_comparison: "Compared the job's steps across runners",
  list_runs: "Read the recent runs",
  weekly_summary: "Read the summary for the period",
  launcher_events: "Read the launcher's events",
  machine_samples: "Read the machine's memory samples",
  runner_state: "Read what the runners are doing now",
  install_settings: "Read the install's numbers and their bounds",
};

export const toolPhrase = (name: string) => PHRASES[name] ?? `Used ${name}`;

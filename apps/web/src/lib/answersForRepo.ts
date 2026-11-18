import type { MachineAnswers } from "./inboxRows.ts";

// One machine's inbox and pull requests narrowed to one repository. An item about no repository,
// such as a machine that stopped taking jobs, holds up every repository's jobs, so it stays.
export const answersForRepo = <Answers extends MachineAnswers>(answers: Answers, repo: string): Answers => ({
  ...answers,
  inbox: answers.inbox && { ...answers.inbox, items: answers.inbox.items.filter((item) => item.repo === null || item.repo === repo) },
  reviews: answers.reviews && { ...answers.reviews, pulls: answers.reviews.pulls.filter((pull) => pull.repo === repo) },
});

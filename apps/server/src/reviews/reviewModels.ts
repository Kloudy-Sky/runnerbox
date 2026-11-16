// The models a review may run on, as names Claude Code takes for the newest of each. Opus is the
// default: on replayed pull requests it found as many of the fixed defects as Fable, in under half
// the time and about a fifth of the cost.
export const REVIEW_MODELS = [
  { id: "opus", label: "Opus" },
  { id: "fable", label: "Fable" },
  { id: "sonnet", label: "Sonnet" },
] as const;
export const DEFAULT_REVIEW_MODEL = "opus";
export const offersReviewModel = (model: string) => REVIEW_MODELS.some((offered) => offered.id === model);

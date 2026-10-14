import type { ScoreWeights } from "./types";

export const DEFAULT_WEIGHTS: ScoreWeights = {
  commit: 1,
  pr_opened: 3,
  pr_merged: 5,
  review: 4,
  comment: 1,
};

export const ACTIVITY_LABELS: Record<keyof ScoreWeights, string> = {
  commit: "Commits",
  pr_opened: "PRs opened",
  pr_merged: "PRs merged",
  review: "Reviews",
  comment: "Review comments",
};

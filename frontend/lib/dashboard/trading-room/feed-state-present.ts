import type { FeedCard, FeedState } from "@/lib/dashboard/trading-room/feed-model";

/**
 * User-facing feed labels — separate structural heat from entry timing where possible.
 */
export const FEED_STATE_LABEL: Record<FeedState, string> = {
  actionable: "Valid setup",
  near: "Near / wait entry",
  potential: "Developing",
  cooling: "Cooling"
};

export function feedCardStateLabel(card: FeedCard): string {
  const verdict = (card.verdict || "").trim().toLowerCase();
  if (card.state === "actionable") {
    if (verdict.includes("execution blocked") || verdict.includes("timing")) {
      return "Valid setup · timing caution";
    }
    if (verdict.includes("in zone") || verdict.includes("enter now")) {
      return "Enter now";
    }
    return FEED_STATE_LABEL.actionable;
  }
  return FEED_STATE_LABEL[card.state];
}

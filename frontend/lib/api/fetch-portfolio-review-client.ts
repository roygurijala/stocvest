/**
 * Client-safe fetch for the daily portfolio review via the same-origin BFF
 * (`/api/stocvest/portfolio-review`). Session-cookie auth is added server-side.
 * This is an expensive call (composites each holding), so callers trigger it
 * explicitly rather than on every render.
 */
import type { PortfolioReview } from "@/lib/portfolio/review-types";

export async function fetchPortfolioReviewClient(): Promise<PortfolioReview | null> {
  const res = await fetch("/api/stocvest/portfolio-review", {
    method: "GET",
    cache: "no-store"
  }).catch(() => null);
  if (!res?.ok) return null;
  try {
    return (await res.json()) as PortfolioReview;
  } catch {
    return null;
  }
}

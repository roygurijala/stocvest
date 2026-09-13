/**
 * Client-safe fetch for the daily portfolio review via the same-origin BFF
 * (`/api/stocvest/portfolio-review`). Session-cookie auth is added server-side.
 *
 * The review composites every holding through the Long-Term desk (~20–28s for a
 * ~11-name book). That work cannot run inside the API Gateway 29s window, so the
 * backend serves `{ pending: true }` and recomputes in the background. This client
 * kicks `?refresh=1` once, then polls the plain GET until a real review arrives.
 */
import type { PortfolioReview } from "@/lib/portfolio/review-types";

export type FetchPortfolioReviewResult =
  | { ok: true; review: PortfolioReview }
  | { ok: false; status: number; message: string };

const POLL_MS = 2_500;
const MAX_WAIT_MS = 90_000;

type ReviewWire = Partial<PortfolioReview> & {
  pending?: boolean;
  message?: string;
  error?: string;
};

async function parseJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function isReview(body: ReviewWire | null): body is PortfolioReview {
  return !!body && Array.isArray(body.holdings) && typeof body.generatedAt === "string";
}

function errorMessage(status: number, body: ReviewWire | null): string {
  if (status === 0) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  if (status === 401 || status === 403) {
    return `Review was rejected (HTTP ${status}). You may be signed out, or the review service isn't available in this environment.`;
  }
  if (status === 504 || status === 502) {
    return `The review timed out (HTTP ${status}). STOCVEST is still reading your holdings — wait a moment and try again.`;
  }
  const detail = body?.message || body?.error;
  return detail || `Could not run the review right now. Please try again. (HTTP ${status})`;
}

async function getReview(refresh: boolean): Promise<{ status: number; body: ReviewWire | null }> {
  const qs = refresh ? "?refresh=1" : "";
  const res = await fetch(`/api/stocvest/portfolio-review${qs}`, {
    method: "GET",
    cache: "no-store"
  }).catch(() => null);
  if (!res) return { status: 0, body: null };
  return { status: res.status, body: await parseJson<ReviewWire>(res) };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function fetchPortfolioReviewClient(): Promise<FetchPortfolioReviewResult> {
  const first = await getReview(true);
  if (first.status === 0 || (first.status >= 400 && first.status !== 504 && first.status !== 502)) {
    return { ok: false, status: first.status, message: errorMessage(first.status, first.body) };
  }
  if (isReview(first.body)) {
    return { ok: true, review: first.body };
  }
  if (first.status >= 400) {
    return { ok: false, status: first.status, message: errorMessage(first.status, first.body) };
  }

  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const poll = await getReview(false);
    if (isReview(poll.body)) {
      return { ok: true, review: poll.body };
    }
    if (poll.status === 0) {
      continue;
    }
    if (poll.status >= 400 && poll.status !== 504 && poll.status !== 502) {
      return { ok: false, status: poll.status, message: errorMessage(poll.status, poll.body) };
    }
  }
  return {
    ok: false,
    status: 504,
    message:
      "The review is still running in the background. Wait a moment and click Run review again."
  };
}

import type {
  PortfolioFollowThrough,
  PortfolioLedgerEvent,
  PortfolioLedgerResponse,
  PortfolioLedgerSummary
} from "@/lib/portfolio/types";

export function parsePortfolioLedger(raw: unknown): PortfolioLedgerResponse | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  const eventsRaw = body.events;
  if (!Array.isArray(eventsRaw)) return null;
  const events = eventsRaw
    .filter((row) => row && typeof row === "object")
    .map((row) => parseEvent(row as Record<string, unknown>))
    .filter((row): row is PortfolioLedgerEvent => row != null);
  const summary = parseSummary(body.summary);
  return {
    events,
    count: typeof body.count === "number" ? body.count : events.length,
    summary
  };
}

function parseEvent(row: Record<string, unknown>): PortfolioLedgerEvent | null {
  const kind = String(row.kind || "");
  const symbol = String(row.symbol || "").toUpperCase();
  if (!symbol || (kind !== "sale" && kind !== "buy" && kind !== "review")) return null;
  return {
    eventId: String(row.eventId || ""),
    kind,
    symbol,
    occurredAt: String(row.occurredAt || ""),
    quantity: num(row.quantity),
    pricePerShare: num(row.pricePerShare),
    costBasisPerShare: num(row.costBasisPerShare),
    realizedPl: num(row.realizedPl),
    realizedPlPct: num(row.realizedPlPct),
    remainingQuantity: num(row.remainingQuantity),
    cashCredited: num(row.cashCredited),
    adviceAction: str(row.adviceAction),
    adviceGeneratedAt: str(row.adviceGeneratedAt),
    adviceVerdict: str(row.adviceVerdict),
    adviceSuggestedAddAmount: num(row.adviceSuggestedAddAmount),
    adviceSuggestedReduceAmount: num(row.adviceSuggestedReduceAmount),
    adviceSizingReason: str(row.adviceSizingReason),
    adviceSleeve: str(row.adviceSleeve),
    priceAtAdvice: num(row.priceAtAdvice),
    weightPct: num(row.weightPct),
    adviceAttributionStatus: str(row.adviceAttributionStatus),
    priceAfter30d: num(row.priceAfter30d),
    priceAfter90d: num(row.priceAfter90d),
    outcome30d: str(row.outcome30d),
    outcome90d: str(row.outcome90d)
  };
}

function parseSummary(raw: unknown): PortfolioLedgerSummary {
  const empty = { favorable: 0, unfavorable: 0, neutral: 0, pending: 0 };
  if (!raw || typeof raw !== "object") {
    return {
      salesCount: 0,
      realizedPl: 0,
      outcome30d: { ...empty },
      outcome90d: { ...empty },
      followThrough: { followed: 0, ignored: 0, diverged: 0 }
    };
  }
  const s = raw as Record<string, unknown>;
  const ft = (s.followThrough || {}) as Record<string, unknown>;
  return {
    salesCount: typeof s.salesCount === "number" ? s.salesCount : 0,
    realizedPl: typeof s.realizedPl === "number" ? s.realizedPl : 0,
    outcome30d: { ...empty, ...((s.outcome30d as object) || {}) },
    outcome90d: { ...empty, ...((s.outcome90d as object) || {}) },
    followThrough: {
      followed: typeof ft.followed === "number" ? ft.followed : 0,
      ignored: typeof ft.ignored === "number" ? ft.ignored : 0,
      diverged: typeof ft.diverged === "number" ? ft.diverged : 0
    }
  };
}

function num(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function str(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  return s || null;
}

function isReduceAdvice(event: PortfolioLedgerEvent): boolean {
  const action = (event.adviceAction || "").toLowerCase();
  if (action === "sell" || action === "trim") return true;
  const reduce = event.adviceSuggestedReduceAmount;
  return action === "hold" && reduce != null && reduce > 0;
}

function episodeStart(review: PortfolioLedgerEvent, all: readonly PortfolioLedgerEvent[]): string {
  const reviews = all
    .filter((e) => e.kind === "review" && e.symbol === review.symbol)
    .slice()
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.eventId.localeCompare(b.eventId));
  let start = review.occurredAt;
  for (let i = reviews.length - 1; i >= 0; i -= 1) {
    const event = reviews[i];
    const afterReview =
      event.occurredAt > review.occurredAt ||
      (event.occurredAt === review.occurredAt && event.eventId > review.eventId);
    if (afterReview) continue;
    if (event.eventId === review.eventId || isReduceAdvice(event)) {
      start = event.occurredAt;
      continue;
    }
    break;
  }
  return start;
}

export function followThroughForReview(
  review: PortfolioLedgerEvent,
  all: readonly PortfolioLedgerEvent[]
): PortfolioFollowThrough {
  if (review.kind !== "review") return "n/a";
  const action = (review.adviceAction || "").toLowerCase();
  const same = all.filter((e) => e.symbol === review.symbol && e.eventId !== review.eventId);
  if (action === "sell" || action === "trim" || isReduceAdvice(review)) {
    const start = episodeStart(review, all);
    const sales = same.some((e) => e.kind === "sale" && e.occurredAt >= start);
    return sales ? "followed" : "ignored";
  }
  const later = same.filter((e) => e.occurredAt >= review.occurredAt);
  const sales = later.some((e) => e.kind === "sale");
  const buys = later.some((e) => e.kind === "buy");
  if (action === "buy_more") return buys ? "followed" : "ignored";
  if (action === "hold") return sales ? "diverged" : "followed";
  return "n/a";
}

export function outcomeLabel(outcome: string | null | undefined): string {
  if (outcome === "favorable") return "Favorable";
  if (outcome === "unfavorable") return "Unfavorable";
  if (outcome === "neutral") return "Neutral";
  return "Pending";
}

export function followThroughLabel(status: string | null | undefined): string {
  if (status === "followed") return "Followed";
  if (status === "ignored") return "Ignored";
  if (status === "diverged") return "Diverged";
  return "—";
}

export function adviceActionLabel(action: string | null | undefined): string {
  if (!action) return "—";
  if (action === "buy_more") return "Buy more";
  if (action === "sell") return "Sell";
  if (action === "trim") return "Trim";
  if (action === "hold") return "Hold";
  if (action === "review") return "Review";
  return action;
}

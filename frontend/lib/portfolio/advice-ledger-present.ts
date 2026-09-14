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

export function followThroughForReview(
  review: PortfolioLedgerEvent,
  all: readonly PortfolioLedgerEvent[]
): PortfolioFollowThrough {
  if (review.kind !== "review") return "n/a";
  const later = all.filter(
    (e) => e.symbol === review.symbol && e.occurredAt >= review.occurredAt && e.eventId !== review.eventId
  );
  const sales = later.some((e) => e.kind === "sale");
  const buys = later.some((e) => e.kind === "buy");
  const action = (review.adviceAction || "").toLowerCase();
  if (action === "sell" || action === "trim") return sales ? "followed" : "ignored";
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

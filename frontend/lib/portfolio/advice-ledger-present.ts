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
    lastConfirmedAt: str(row.adviceLastConfirmedAt) ?? str(row.lastConfirmedAt),
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

function episodeKey(event: PortfolioLedgerEvent): string {
  const action = (event.adviceAction || "").toLowerCase();
  const addOn = (event.adviceSuggestedAddAmount ?? 0) > 0;
  const reduceOn = (event.adviceSuggestedReduceAmount ?? 0) > 0;
  if (action === "trim" || (action === "hold" && reduceOn)) return "trim";
  if (action === "buy_more" || (action === "hold" && addOn)) return "add";
  if (action === "hold") return "hold";
  if (action === "sell") return "sell";
  return `${action}|${addOn ? 1 : 0}|${reduceOn ? 1 : 0}`;
}

export type AdviceEpisodeRow = {
  eventId: string;
  symbol: string;
  action: string | null;
  suggestedAddAmount: number | null;
  suggestedReduceAmount: number | null;
  startedAt: string;
  lastConfirmedAt: string;
  priceAtAdvice: number | null;
  outcome30d: string | null;
  outcome90d: string | null;
  followThrough: PortfolioFollowThrough;
};

/** Collapse leftover same-call restamps so each recommendation is one episode. */
export function buildAdviceEpisodeRows(
  events: readonly PortfolioLedgerEvent[]
): AdviceEpisodeRow[] {
  const reviews = events
    .filter((e) => e.kind === "review")
    .slice()
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.eventId.localeCompare(b.eventId));
  const groups: PortfolioLedgerEvent[][] = [];
  const lastGroupBySymbol = new Map<string, PortfolioLedgerEvent[]>();
  for (const event of reviews) {
    const prev = lastGroupBySymbol.get(event.symbol);
    const last = prev?.[prev.length - 1];
    if (last && episodeKey(last) === episodeKey(event)) {
      prev.push(event);
      continue;
    }
    const next = [event];
    groups.push(next);
    lastGroupBySymbol.set(event.symbol, next);
  }
  const rows = groups.map((group) => {
    const first = group[0];
    const last = group[group.length - 1];
    return {
      eventId: first.eventId,
      symbol: first.symbol,
      action: first.adviceAction,
      suggestedAddAmount: first.adviceSuggestedAddAmount,
      suggestedReduceAmount: first.adviceSuggestedReduceAmount,
      startedAt: first.occurredAt,
      lastConfirmedAt: last.lastConfirmedAt || last.occurredAt,
      priceAtAdvice: first.priceAtAdvice,
      outcome30d: first.outcome30d,
      outcome90d: first.outcome90d,
      followThrough: followThroughForReview(first, events)
    };
  });
  rows.sort(
    (a, b) =>
      b.lastConfirmedAt.localeCompare(a.lastConfirmedAt) ||
      b.startedAt.localeCompare(a.startedAt) ||
      a.symbol.localeCompare(b.symbol)
  );
  return rows;
}

/** Calendar day of the call — "Sep 14". */
export function formatAdviceDay(iso: string): string {
  const raw = (iso || "").slice(0, 10);
  const [y, m, d] = raw.split("-").map(Number);
  if (!y || !m || !d) return iso || "";
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  });
}

/** "Sep 14" or "Sep 14–15" when the same call was confirmed later. */
export function formatEpisodeWindow(startedAt: string, lastConfirmedAt: string): string {
  const start = formatAdviceDay(startedAt);
  if (!lastConfirmedAt || lastConfirmedAt.slice(0, 10) === startedAt.slice(0, 10)) return start;
  const last = formatAdviceDay(lastConfirmedAt);
  const startMonth = start.split(" ")[0];
  const lastParts = last.split(" ");
  if (startMonth === lastParts[0] && lastParts[1]) return `${start}–${lastParts[1]}`;
  return `${start} – ${last}`;
}

function resolvedOutcome(outcome: string | null | undefined): string | null {
  if (outcome === "favorable" || outcome === "unfavorable" || outcome === "neutral") return outcome;
  return null;
}

/** Hide pending — only show a result once 30d or 90d has actually printed. */
export function episodeResultLabel(row: Pick<AdviceEpisodeRow, "outcome30d" | "outcome90d">): string {
  const parts: string[] = [];
  const d30 = resolvedOutcome(row.outcome30d);
  const d90 = resolvedOutcome(row.outcome90d);
  if (d30) parts.push(`30d ${outcomeLabel(d30).toLowerCase()}`);
  if (d90) parts.push(`90d ${outcomeLabel(d90).toLowerCase()}`);
  return parts.join(" · ");
}

/** Hold+reduce is a trim; hold+add is an add. Amount size is not shown. */
export function episodeCallLabel(
  row: Pick<AdviceEpisodeRow, "action" | "suggestedAddAmount" | "suggestedReduceAmount">
): string {
  const action = (row.action || "").toLowerCase();
  const addOn = (row.suggestedAddAmount ?? 0) > 0;
  const reduceOn = (row.suggestedReduceAmount ?? 0) > 0;
  if (action === "sell") return "Sell";
  if (action === "trim" || (action === "hold" && reduceOn)) return "Trim";
  if (action === "buy_more") return "Buy more";
  if (action === "hold" && addOn) return "Add";
  if (action === "hold") return "Hold";
  if (action === "review") return "Review";
  return adviceActionLabel(row.action);
}

/** Followed and still-open are quiet. Only a hold you sold against is labeled. */
export function episodeStanceLabel(row: Pick<AdviceEpisodeRow, "followThrough">): string {
  if (row.followThrough === "diverged") return "Sold";
  return "";
}

/** Result if it has printed; otherwise only an exception stance. */
export function episodeAfterLabel(row: AdviceEpisodeRow): string {
  const result = episodeResultLabel(row);
  const stance = episodeStanceLabel(row);
  if (result && stance) return `${result} · ${stance.toLowerCase()}`;
  return result || stance;
}

export function episodeAfterTone(row: AdviceEpisodeRow): "good" | "bad" | "quiet" {
  const d30 = resolvedOutcome(row.outcome30d);
  const d90 = resolvedOutcome(row.outcome90d);
  if (d30 === "unfavorable" || d90 === "unfavorable") return "bad";
  if (row.followThrough === "diverged") return "bad";
  if (d30 === "favorable" || d90 === "favorable") return "good";
  return "quiet";
}

export function adviceTrackSummaryLine(rows: readonly AdviceEpisodeRow[]): string {
  const n = rows.length;
  if (n === 0) return "";
  const open = rows.filter((r) => r.followThrough === "ignored").length;
  const diverged = rows.filter((r) => r.followThrough === "diverged").length;
  const withResult = rows.filter((r) => episodeResultLabel(r) !== "").length;
  const bits = [`${n} recommendation${n === 1 ? "" : "s"}`];
  if (open) bits.push(`${open} still open`);
  if (diverged) bits.push(`${diverged} diverged`);
  if (withResult) bits.push(`${withResult} scored`);
  return `${bits.join(" · ")}.`;
}

function isLaterEpisode(a: AdviceEpisodeRow, b: AdviceEpisodeRow): boolean {
  return (
    a.lastConfirmedAt.localeCompare(b.lastConfirmedAt) > 0 ||
    (a.lastConfirmedAt === b.lastConfirmedAt && a.startedAt.localeCompare(b.startedAt) > 0)
  );
}

/** Current call per symbol, plus older calls only when After has meaning. */
export function selectAdviceTrackRows(rows: readonly AdviceEpisodeRow[]): AdviceEpisodeRow[] {
  const latest = new Map<string, AdviceEpisodeRow>();
  for (const row of rows) {
    const cur = latest.get(row.symbol);
    if (!cur || isLaterEpisode(row, cur)) latest.set(row.symbol, row);
  }
  const current = [...latest.values()].sort(
    (a, b) =>
      b.lastConfirmedAt.localeCompare(a.lastConfirmedAt) ||
      b.startedAt.localeCompare(a.startedAt) ||
      a.symbol.localeCompare(b.symbol)
  );
  const earlier = rows.filter((row) => latest.get(row.symbol) !== row && episodeAfterLabel(row));
  return [...current, ...earlier];
}

/** "since Sep 14 at $212.39" — price omitted when missing. */
export function adviceTrackSinceLine(startedAt: string, priceLabel?: string | null): string {
  const day = formatAdviceDay(startedAt);
  const price = (priceLabel || "").trim();
  if (price && price !== "—") return `since ${day} at ${price}`;
  return day ? `since ${day}` : "";
}

function formatUsdEn(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** Already-computed do-this dollars. Hold / Review stay badge-only. */
export function episodeCallSizeAmount(
  row: Pick<AdviceEpisodeRow, "action" | "suggestedAddAmount" | "suggestedReduceAmount">
): number | null {
  const call = episodeCallLabel(row);
  if (call === "Trim" || call === "Sell") {
    const n = row.suggestedReduceAmount;
    return n != null && Number.isFinite(n) && n > 0 ? n : null;
  }
  if (call === "Add" || call === "Buy more") {
    const n = row.suggestedAddAmount;
    return n != null && Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

export function episodeCallSizeLabel(
  row: Pick<AdviceEpisodeRow, "action" | "suggestedAddAmount" | "suggestedReduceAmount">
): string {
  const n = episodeCallSizeAmount(row);
  return n == null ? "" : formatUsdEn(n);
}

export type AdviceTrackNowMove = {
  label: string;
  tone: "up" | "down" | "flat";
};

/**
 * Live last vs frozen advice price. A move, not a 30/90d score —
 * do not map this onto favorable/unfavorable.
 */
export function adviceTrackNowMove(
  priceAtAdvice: number | null | undefined,
  priceNow: number | null | undefined
): AdviceTrackNowMove | null {
  if (priceNow == null || !Number.isFinite(priceNow) || priceNow <= 0) return null;
  const nowLabel = formatUsdEn(priceNow);
  if (priceAtAdvice == null || !Number.isFinite(priceAtAdvice) || priceAtAdvice <= 0) {
    return { label: `now ${nowLabel}`, tone: "flat" };
  }
  const pct = ((priceNow - priceAtAdvice) / priceAtAdvice) * 100;
  const sign = pct > 0 ? "+" : "";
  const tone: AdviceTrackNowMove["tone"] = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
  return { label: `now ${nowLabel} · ${sign}${pct.toFixed(1)}%`, tone };
}

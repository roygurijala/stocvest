import type { SetupOutcomeEvent, SetupOutcomesResponse } from "@/lib/api/setup-outcomes";

export type OutcomeFilter = "all" | "bias_confirmed" | "improved" | "held" | "weakened";

export type OutcomeSort = "date_desc" | "date_asc" | "symbol";

export type OutcomeView = "by_symbol" | "flat";

export const OUTCOME_LABEL: Record<string, string> = {
  alignment_held: "Alignment held",
  alignment_weakened: "Alignment weakened",
  state_improved: "State improved",
  state_worsened: "State weakened",
  setup_continuation: "Bias confirmed",
  insufficient_data: "Insufficient follow-up"
};

export const OUTCOME_BADGE: Record<
  string,
  { label: string; tone: "bullish" | "caution" | "bearish" | "muted" | "accent" }
> = {
  setup_continuation: { label: "Bias confirmed", tone: "accent" },
  alignment_held: { label: "Held", tone: "bullish" },
  state_improved: { label: "Improved", tone: "bullish" },
  alignment_weakened: { label: "Weakened", tone: "caution" },
  state_worsened: { label: "Weakened", tone: "caution" },
  insufficient_data: { label: "Insufficient", tone: "muted" }
};

export type DonutSegment = { id: string; label: string; count: number; color: string };

export function outcomeMatchesFilter(kind: string, filter: OutcomeFilter): boolean {
  if (filter === "all") return true;
  if (filter === "bias_confirmed") return kind === "setup_continuation";
  if (filter === "improved") return kind === "state_improved";
  if (filter === "held") return kind === "alignment_held" || kind === "setup_continuation";
  if (filter === "weakened") return kind === "alignment_weakened" || kind === "state_worsened";
  return true;
}

export function filterOutcomeEvents(events: SetupOutcomeEvent[], filter: OutcomeFilter): SetupOutcomeEvent[] {
  return events.filter((e) => outcomeMatchesFilter(e.outcome_kind, filter));
}

export function sortOutcomeEvents(events: SetupOutcomeEvent[], sort: OutcomeSort): SetupOutcomeEvent[] {
  const copy = [...events];
  if (sort === "symbol") {
    return copy.sort((a, b) => a.symbol.localeCompare(b.symbol) || b.session_date.localeCompare(a.session_date));
  }
  if (sort === "date_asc") {
    return copy.sort((a, b) => a.session_date.localeCompare(b.session_date));
  }
  return copy.sort((a, b) => b.session_date.localeCompare(a.session_date));
}

export function searchOutcomeEvents(events: SetupOutcomeEvent[], query: string): SetupOutcomeEvent[] {
  const q = query.trim().toUpperCase();
  if (!q) return events;
  return events.filter((e) => e.symbol.toUpperCase().includes(q));
}

export type SymbolOutcomeGroup = {
  symbol: string;
  events: SetupOutcomeEvent[];
  headlineBadge: (typeof OUTCOME_BADGE)[string];
  latestDate: string;
};

export function groupOutcomeEventsBySymbol(events: SetupOutcomeEvent[]): SymbolOutcomeGroup[] {
  const bySym = new Map<string, SetupOutcomeEvent[]>();
  for (const e of events) {
    const list = bySym.get(e.symbol) ?? [];
    list.push(e);
    bySym.set(e.symbol, list);
  }
  const groups: SymbolOutcomeGroup[] = [];
  for (const [symbol, rows] of bySym) {
    const sorted = sortOutcomeEvents(rows, "date_desc");
    const headline = sorted[0];
    groups.push({
      symbol,
      events: sorted,
      headlineBadge: OUTCOME_BADGE[headline.outcome_kind] ?? OUTCOME_BADGE.insufficient_data,
      latestDate: headline.session_date
    });
  }
  return groups.sort((a, b) => b.latestDate.localeCompare(a.latestDate) || a.symbol.localeCompare(b.symbol));
}

export function buildDonutSegments(
  byKind: Record<string, number>,
  colors: { bullish: string; caution: string; accent: string }
): DonutSegment[] {
  const held = (byKind.alignment_held ?? 0) + (byKind.setup_continuation ?? 0);
  const weakened = (byKind.alignment_weakened ?? 0) + (byKind.state_worsened ?? 0);
  const improved =
    (byKind.state_improved ?? 0) +
    Object.entries(byKind).reduce((n, [k, v]) => {
      if (k === "alignment_held" || k === "setup_continuation" || k === "alignment_weakened" || k === "state_worsened" || k === "state_improved") {
        return n;
      }
      return n + v;
    }, 0);
  return [
    { id: "held", label: "Held", count: held, color: colors.bullish },
    { id: "weakened", label: "Weakened", count: weakened, color: colors.caution },
    { id: "improved", label: "Improved / other", count: improved, color: colors.accent }
  ].filter((s) => s.count > 0);
}

export function biasConfirmedEvents(events: SetupOutcomeEvent[]): SetupOutcomeEvent[] {
  return events.filter((e) => e.outcome_kind === "setup_continuation").slice(0, 8);
}

export function formatSessionDateLabel(raw: string): string {
  const d = raw.slice(0, 10);
  if (!d) return raw;
  try {
    const today = new Date().toISOString().slice(0, 10);
    if (d === today) return "Today";
    const dt = new Date(`${d}T12:00:00`);
    return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return d;
  }
}

export function layerDeltaLabel(event: SetupOutcomeEvent): string {
  const next = event.next_layers_aligned;
  if (next == null) return `${event.layers_aligned}/${event.layers_total}`;
  const delta = next - event.layers_aligned;
  if (delta > 0) return `${event.layers_aligned}→${next}`;
  if (delta < 0) return `${event.layers_aligned}→${next}`;
  return `${event.layers_aligned}/${event.layers_total}`;
}

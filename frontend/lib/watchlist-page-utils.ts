import type { SnapshotPayload } from "@/lib/api/market";

export type WatchlistMaturationRow = {
  state?: string;
  readiness_label?: string;
  label?: string;
  layers_aligned?: number;
  layers_total?: number;
  last_evaluated_at?: string;
  missing_layers?: string[];
  bias?: string;
};

export type WatchlistViewMode = "swing" | "day" | "both";

/**
 * Parse the company / issuer portion from typeahead labels such as
 * ``TSLA — Tesla, Inc.`` (em-dash, en-dash, hyphen, or pipe after the ticker).
 * Returns empty when the label is ticker-only.
 */
export function parseCompanyNameFromTickerCandidateLabel(label: string, symbolUpper: string): string {
  const raw = label.trim();
  const sym = symbolUpper.trim().toUpperCase();
  if (!raw || !sym) return "";
  if (raw.toUpperCase() === sym) return "";
  if (!raw.toUpperCase().startsWith(sym)) return "";
  let rest = raw.slice(sym.length).trimStart();
  if (!rest) return "";
  if (rest.startsWith("—") || rest.startsWith("–") || rest.startsWith("-") || rest.startsWith("|")) {
    return rest.replace(/^[—–\-|]\s*/, "").trim();
  }
  return "";
}

/** Uppercase unique symbols, first occurrence wins (stable order). */
export function dedupeWatchlistSymbolsUpper(symbols: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of symbols) {
    const u = raw.trim().toUpperCase();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

export function formatWatchlistMaturationLabel(m: WatchlistMaturationRow | undefined): string {
  const raw = (m?.label || m?.state || "").trim();
  if (!raw) return "—";
  return raw.replace(/_/g, " ");
}

/**
 * Coerce maturation-summary JSON (`by_symbol` or legacy `bySymbol`; symbol keys normalized to uppercase).
 */
export function normalizeWatchlistMaturationBySymbol(payload: unknown): Record<string, WatchlistMaturationRow> {
  if (!payload || typeof payload !== "object") return {};
  const p = payload as Record<string, unknown>;
  const raw =
    (p.by_symbol && typeof p.by_symbol === "object" ? p.by_symbol : null) ??
    (p.bySymbol && typeof p.bySymbol === "object" ? p.bySymbol : null);
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, WatchlistMaturationRow> = {};
  for (const [k, v] of Object.entries(raw)) {
    const sym = k.trim().toUpperCase();
    if (!sym) continue;
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const state = String(o.state ?? "").trim();
    const label = String(o.label ?? "").trim();
    const readinessRaw = o.readiness_label ?? o.readinessLabel;
    const readiness = typeof readinessRaw === "string" ? readinessRaw.trim() : "";
    const alignedRaw = o.layers_aligned ?? o.layersAligned;
    const totalRaw = o.layers_total ?? o.layersTotal;
    const row: WatchlistMaturationRow = {};
    if (state) row.state = state;
    if (label) row.label = label;
    if (readiness) row.readiness_label = readiness;
    if (typeof alignedRaw === "number" && Number.isFinite(alignedRaw)) row.layers_aligned = alignedRaw;
    if (typeof totalRaw === "number" && Number.isFinite(totalRaw)) row.layers_total = totalRaw;
    const lastEvalRaw = o.last_evaluated_at ?? o.lastEvaluatedAt;
    if (typeof lastEvalRaw === "string" && lastEvalRaw.trim()) row.last_evaluated_at = lastEvalRaw.trim();
    const missingRaw = o.missing_layers ?? o.missingLayers;
    if (Array.isArray(missingRaw)) {
      row.missing_layers = missingRaw
        .map((x) => (typeof x === "string" ? x.trim().toLowerCase() : ""))
        .filter(Boolean);
    }
    const biasRaw = o.bias;
    if (typeof biasRaw === "string" && biasRaw.trim()) row.bias = biasRaw.trim().toLowerCase();
    if (!row.state && !row.label) continue;
    out[sym] = row;
  }
  return out;
}

/**
 * Watchlist filter / on-list typeahead: ticker + company name always; maturation text only for the active desk
 * (swing OR day). In “Both” maturation view, do not search swing+day text together — symbol + company only.
 */
export function watchlistSymbolMatchesSearch(
  sym: string,
  rawQuery: string,
  viewMode: WatchlistViewMode,
  dualDeskMaturation: boolean,
  snap: SnapshotPayload | undefined,
  ms: WatchlistMaturationRow | undefined,
  md: WatchlistMaturationRow | undefined,
  /** When snapshots have not loaded yet, e.g. issuer from ticker-search results. */
  companyNameFallback?: string | null
): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  const symU = sym.trim().toUpperCase();
  if (symU.toLowerCase().includes(q)) return true;
  const company = ((snap?.company_name ?? "").trim() || (companyNameFallback ?? "").trim()).toLowerCase();
  if (company.includes(q)) return true;
  if (viewMode === "both" && dualDeskMaturation) return false;
  const swingBlob = `${formatWatchlistMaturationLabel(ms)} ${ms?.readiness_label ?? ""}`.toLowerCase();
  const dayBlob = `${formatWatchlistMaturationLabel(md)} ${md?.readiness_label ?? ""}`.toLowerCase();
  if (viewMode === "swing" || !dualDeskMaturation) return swingBlob.includes(q);
  if (viewMode === "day") return dayBlob.includes(q);
  return false;
}

export function watchlistQuoteFromSnapshot(snap: SnapshotPayload | undefined): {
  price: string;
  pct: string | null;
  bullish: boolean | null;
} | null {
  if (!snap) return null;
  const last = snap.last_trade_price;
  const close = snap.day_close;
  const p =
    typeof last === "number" && Number.isFinite(last)
      ? last
      : typeof close === "number" && Number.isFinite(close)
        ? close
        : null;
  if (p === null) return null;
  const ch = snap.change_percent;
  let pct: string | null = null;
  let bullish: boolean | null = null;
  if (typeof ch === "number" && Number.isFinite(ch)) {
    pct = `${ch >= 0 ? "+" : ""}${ch.toFixed(2)}%`;
    bullish = ch > 0 ? true : ch < 0 ? false : null;
  }
  return { price: `$${p.toFixed(2)}`, pct, bullish };
}

/** Day-desk scanner synthesis from setups v2 / scanner-trace API. */

export type ScannerSynthesisVolumeContext = {
  avg_pct_below: number;
  trend: "improving" | "stable" | "worsening";
  time_of_day: "early" | "mid" | "late";
  recovery_likely: boolean;
  market_condition: string;
};

export type ScannerSynthesisNearMiss = {
  symbol: string;
  pct_of_needed: number;
  structure_note: string;
  is_market_proxy: boolean;
};

export type ScannerSynthesisRejectionGroups = {
  session_volume: Array<{ symbol: string; pct_below: number }>;
  liquidity: Array<{ symbol: string }>;
  structure: Array<{ symbol: string; reason: string }>;
  other?: Array<{ symbol: string; reason: string }>;
};

export type ScannerSynthesis = {
  qualified_count: number;
  market_summary: string;
  what_would_change: string;
  session_time_et: string;
  volume_context: ScannerSynthesisVolumeContext | null;
  near_misses: ScannerSynthesisNearMiss[];
  rejection_groups: ScannerSynthesisRejectionGroups;
};

export function parseScannerSynthesis(data: unknown): ScannerSynthesis | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const market_summary = String(o.market_summary ?? "").trim();
  const what_would_change = String(o.what_would_change ?? "").trim();
  if (!market_summary && !what_would_change && o.qualified_count == null) return null;

  const volume_context = parseVolumeContext(o.volume_context);
  const near_misses = parseNearMisses(o.near_misses);
  const rejection_groups = parseRejectionGroups(o.rejection_groups);

  return {
    qualified_count: typeof o.qualified_count === "number" ? o.qualified_count : 0,
    market_summary,
    what_would_change,
    session_time_et: String(o.session_time_et ?? "").trim(),
    volume_context,
    near_misses,
    rejection_groups
  };
}

function parseVolumeContext(raw: unknown): ScannerSynthesisVolumeContext | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.avg_pct_below !== "number") return null;
  const trendRaw = String(v.trend ?? "stable");
  const trend =
    trendRaw === "improving" || trendRaw === "worsening" ? trendRaw : ("stable" as const);
  const todRaw = String(v.time_of_day ?? "mid");
  const time_of_day =
    todRaw === "early" || todRaw === "late" ? todRaw : ("mid" as const);
  return {
    avg_pct_below: v.avg_pct_below,
    trend,
    time_of_day,
    recovery_likely: Boolean(v.recovery_likely),
    market_condition: String(v.market_condition ?? "Normal")
  };
}

function parseNearMisses(raw: unknown): ScannerSynthesisNearMiss[] {
  if (!Array.isArray(raw)) return [];
  const out: ScannerSynthesisNearMiss[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const symbol = String(r.symbol ?? "").trim().toUpperCase();
    if (!symbol || typeof r.pct_of_needed !== "number") continue;
    out.push({
      symbol,
      pct_of_needed: r.pct_of_needed,
      structure_note: String(r.structure_note ?? "").trim(),
      is_market_proxy: Boolean(r.is_market_proxy)
    });
  }
  return out;
}

function parseRejectionGroups(raw: unknown): ScannerSynthesisRejectionGroups {
  const empty: ScannerSynthesisRejectionGroups = {
    session_volume: [],
    liquidity: [],
    structure: []
  };
  if (!raw || typeof raw !== "object") return empty;
  const g = raw as Record<string, unknown>;
  const session_volume: Array<{ symbol: string; pct_below: number }> = [];
  if (Array.isArray(g.session_volume)) {
    for (const row of g.session_volume) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const symbol = String(r.symbol ?? "").trim().toUpperCase();
      if (!symbol || typeof r.pct_below !== "number") continue;
      session_volume.push({ symbol, pct_below: r.pct_below });
    }
  }
  const liquidity: Array<{ symbol: string }> = [];
  if (Array.isArray(g.liquidity)) {
    for (const row of g.liquidity) {
      if (!row || typeof row !== "object") continue;
      const symbol = String((row as Record<string, unknown>).symbol ?? "").trim().toUpperCase();
      if (symbol) liquidity.push({ symbol });
    }
  }
  const structure: Array<{ symbol: string; reason: string }> = [];
  if (Array.isArray(g.structure)) {
    for (const row of g.structure) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const symbol = String(r.symbol ?? "").trim().toUpperCase();
      if (!symbol) continue;
      structure.push({ symbol, reason: String(r.reason ?? "").trim() });
    }
  }
  const other: Array<{ symbol: string; reason: string }> = [];
  if (Array.isArray(g.other)) {
    for (const row of g.other) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const symbol = String(r.symbol ?? "").trim().toUpperCase();
      if (!symbol) continue;
      other.push({ symbol, reason: String(r.reason ?? "").trim() });
    }
  }
  return { session_volume, liquidity, structure, ...(other.length ? { other } : {}) };
}

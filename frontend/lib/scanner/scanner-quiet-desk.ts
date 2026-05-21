import {
  alignmentDisplayMeta,
  layersAwayFromActionable,
  resolveAlignmentDisplayTier
} from "@/lib/alignment-display-tier";
import { regimeFromSpyQqq } from "@/lib/market-context/regime";
import type { ScannerNearQualificationRow, ScannerWatchlistProgressionRow } from "@/lib/scanner-scan-summary";
import type { ScannerSynthesis } from "@/lib/scanner-synthesis";

export type NearReadyMomentum = "improving" | "stable" | "re_eval" | "weakening";

/** Minimum aligned layers to show in market-wide activity (filters 0/6 noise). */
export const MIN_DEVELOPING_ALIGNED = 3;

export type NearReadyCardModel = {
  symbol: string;
  desk: "swing" | "day";
  deskLabel: string;
  source: "alignment" | "volume";
  alignmentHeadline: string;
  readinessHint: string;
  confirmedLines: string[];
  blockedLine: string;
  urgencyLine: string;
  momentum: NearReadyMomentum;
  momentumLabel: string;
  evidenceHref: string;
};

export type VolumeProximityLead = {
  symbol: string;
  fillPct: number;
  pctBelow: number;
};

/** Top session-volume rows (closest on pace) — not the same as structural near-ready. */
export function buildVolumeProximityLeads(
  synthesis: ScannerSynthesis | null | undefined,
  excludeSymbols: Set<string>,
  limit = 2
): VolumeProximityLead[] {
  const rows = synthesis?.rejection_groups.session_volume ?? [];
  return [...rows]
    .filter((r) => !excludeSymbols.has(r.symbol))
    .sort((a, b) => a.pct_below - b.pct_below)
    .slice(0, limit)
    .map((r) => ({
      symbol: r.symbol,
      fillPct: Math.max(0, Math.min(100, Math.round(100 - r.pct_below))),
      pctBelow: r.pct_below
    }));
}

export function volumeLeadToNearReadyCard(
  lead: VolumeProximityLead,
  regimeLabel: string,
  rank = 0
): NearReadyCardModel {
  const blocked = regimeBlocksDesk(regimeLabel);
  return {
    symbol: lead.symbol,
    desk: "swing",
    deskLabel: "volume",
    source: "volume" as const,
    alignmentHeadline: `${lead.fillPct}% of session pace met`,
    readinessHint:
      rank === 0
        ? "Nearest to qualifying on volume today — still below threshold"
        : "Also relatively close on session pace",
    confirmedLines: [
      "Structure may be intact — participation has not confirmed",
      "Watch this symbol if session pace recovers"
    ],
    blockedLine: blocked ? "Blocked by regime (volume also weak)" : "Blocked by session volume — not regime",
    urgencyLine: "→ First signal if participation recovers",
    momentum: lead.fillPct >= 25 ? "improving" : "stable",
    momentumLabel: lead.fillPct >= 25 ? "↑ closest on volume" : "→ closest on volume",
    evidenceHref: `/dashboard/signals?symbol=${encodeURIComponent(lead.symbol)}&ref=scanner&trading_mode=swing`
  };
}

export type DevelopingRowModel = {
  symbol: string;
  desk: "swing" | "day";
  displaySymbol: string;
  directionLabel: string;
  alignmentLabel: string;
  missingHint: string;
  movement: "improving" | "stable" | "weakening";
  watchlistHref: string;
};

export type WhatWouldChangeContent = {
  watchItems: string[];
  outcome: string;
};

export type DevelopingMovementGroups = {
  improving: DevelopingRowModel[];
  stable: DevelopingRowModel[];
  weakening: DevelopingRowModel[];
};

export function regimeBlocksDesk(regimeLabel: string): boolean {
  const r = regimeLabel.trim().toLowerCase();
  return r.includes("bear");
}

export function nearReadySectionCopy(regimeLabel: string): { title: string; subtitle: string } {
  if (regimeBlocksDesk(regimeLabel)) {
    return {
      title: "Near Ready (Blocked by Regime)",
      subtitle: "Structure intact — will qualify if regime clears"
    };
  }
  return {
    title: "Near Ready",
    subtitle: "Approaching threshold — not actionable until gates clear"
  };
}

export function movementLabelFromBucket(
  bucket: "improving" | "stable" | "weakening" | "re_eval"
): string {
  switch (bucket) {
    case "improving":
      return "↑ improving";
    case "weakening":
      return "↓ weakening";
    case "re_eval":
      return "↻ re-eval";
    default:
      return "→ stable";
  }
}

function momentumFromRow(
  tier: ReturnType<typeof resolveAlignmentDisplayTier>,
  layersAway: number
): { kind: NearReadyMomentum; label: string } {
  if (tier === "re_evaluating") return { kind: "re_eval", label: movementLabelFromBucket("re_eval") };
  if (tier === "near_ready" && layersAway <= 1)
    return { kind: "improving", label: movementLabelFromBucket("improving") };
  if (tier === "developing" && layersAway >= 3)
    return { kind: "weakening", label: movementLabelFromBucket("weakening") };
  return { kind: "stable", label: movementLabelFromBucket("stable") };
}

export function alignmentLabelWithMovement(aligned: number, total: number, movementLabel: string): string {
  return `${aligned}/${total} aligned ${movementLabel}`;
}

function deskBadge(desk: "swing" | "day"): string {
  return desk === "swing" ? "swing" : "day";
}

function displaySymbolForRow(symbol: string, desk: "swing" | "day", showDesk: boolean): string {
  return showDesk ? `${symbol} (${deskBadge(desk)})` : symbol;
}

function confirmedLinesForRow(
  aligned: number,
  total: number,
  layersAway: number
): string[] {
  const lines: string[] = [];
  if (aligned >= 4) {
    lines.push("Technical + sector confirmed");
  } else if (aligned >= 3) {
    lines.push("Structure forming — partial confirmation");
  } else {
    lines.push("Early alignment — structure still building");
  }
  if (layersAway <= 1 && aligned >= 4) {
    lines.push("One condition from actionable");
  }
  return lines;
}

export function buildNearReadyCards(
  rows: ScannerNearQualificationRow[],
  regimeLabel: string,
  deskFilter: "swing" | "day" | "all"
): NearReadyCardModel[] {
  const blocked = regimeBlocksDesk(regimeLabel);
  const filtered =
    deskFilter === "all" ? rows : rows.filter((r) => r.desk === deskFilter);

  return filtered
    .filter((row) => {
      const aligned = row.alignment?.aligned ?? 0;
      const total = row.alignment?.total ?? 6;
      const tier = resolveAlignmentDisplayTier({ layersAligned: aligned, layersTotal: total });
      return tier === "near_ready" || tier === "actionable" || aligned >= 4;
    })
    .map((row) => {
      const aligned = row.alignment?.aligned ?? 0;
      const total = row.alignment?.total ?? 6;
      const away = row.layers_away ?? layersAwayFromActionable(aligned, total);
      const tier = resolveAlignmentDisplayTier({ layersAligned: aligned, layersTotal: total });
      const momentum = momentumFromRow(tier, away);
      const alignmentHeadline = alignmentLabelWithMovement(aligned, total, momentum.label);
      const readinessHint =
        away <= 1 ? "Close to ready" : `${away} condition${away === 1 ? "" : "s"} from actionable`;

      const blockedLine = blocked
        ? "Blocked by regime"
        : away > 0
          ? `${away} layer${away === 1 ? "" : "s"} from actionable`
          : "Awaiting final confirmation";

      const urgencyLine = blocked
        ? "→ Will trigger if regime clears"
        : away <= 1
          ? "→ May qualify on the next scan if volume and gates align"
          : "";

      const mode = row.desk === "swing" ? "swing" : "day";
      return {
        symbol: row.symbol,
        desk: row.desk,
        deskLabel: deskBadge(row.desk),
        source: "alignment" as const,
        alignmentHeadline,
        readinessHint,
        confirmedLines: confirmedLinesForRow(aligned, total, away),
        blockedLine,
        urgencyLine,
        momentum: momentum.kind,
        momentumLabel: momentum.label,
        evidenceHref: `/dashboard/signals?symbol=${encodeURIComponent(row.symbol)}&ref=scanner&trading_mode=${mode}`
      };
    })
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

function movementBucket(
  row: ScannerWatchlistProgressionRow
): "improving" | "stable" | "weakening" {
  const st = (row.state || "").toLowerCase();
  const aligned = row.layers_aligned ?? 0;
  const away = row.layers_away ?? layersAwayFromActionable(aligned, row.layers_total ?? 6);
  if (st.includes("re_eval")) return "stable";
  if (st.includes("invalid")) return "weakening";
  if (away <= 1 && aligned >= 4) return "improving";
  if (aligned <= 2) return "weakening";
  return "stable";
}

export function buildDevelopingMovementGroups(
  rows: ScannerWatchlistProgressionRow[],
  deskFilter: "swing" | "day" | "all",
  excludeSymbols: Set<string>
): DevelopingMovementGroups {
  const showDesk = deskFilter === "all";
  const filtered = rows.filter((r) => {
    if (excludeSymbols.has(r.symbol)) return false;
    if (deskFilter !== "all" && r.desk !== deskFilter) return false;
    const st = (r.state || "").toLowerCase();
    if (st.includes("actionable")) return false;
    const aligned = r.layers_aligned ?? 0;
    return aligned >= MIN_DEVELOPING_ALIGNED;
  });

  const out: DevelopingMovementGroups = { improving: [], stable: [], weakening: [] };

  for (const row of filtered) {
    const aligned = row.layers_aligned ?? 0;
    const total = row.layers_total ?? 6;
    const away = row.layers_away ?? layersAwayFromActionable(aligned, total);
    const bucket = movementBucket(row);
    const movementLabel = movementLabelFromBucket(bucket);
    const dir = (row.label || row.state || "Developing").toLowerCase().includes("short") ? "Short" : "Long";
    const missing =
      away > 0
        ? `${away} layer${away === 1 ? "" : "s"} from actionable`
        : "Alignment building";

    const model: DevelopingRowModel = {
      symbol: row.symbol,
      desk: row.desk,
      displaySymbol: displaySymbolForRow(row.symbol, row.desk, showDesk),
      directionLabel: dir,
      alignmentLabel: alignmentLabelWithMovement(aligned, total, movementLabel),
      missingHint: missing,
      movement: bucket,
      watchlistHref: `/dashboard/watchlists?focus=${encodeURIComponent(row.symbol)}`
    };
    out[bucket].push(model);
  }

  for (const key of ["improving", "stable", "weakening"] as const) {
    out[key].sort((a, b) => a.symbol.localeCompare(b.symbol));
  }
  return out;
}

export function regimeGateRejectionTitle(count: number, regimeLabel: string): string {
  return `Blocked by Regime (${count} symbol${count === 1 ? "" : "s"})`;
}

export function regimeGateRejectionContext(
  regimeLabel: string,
  spyPct: number | null,
  qqqPct: number | null
): string {
  const r = regimeLabel.trim().toLowerCase();
  if (r.includes("bear")) {
    return "Will unlock if SPY/QQQ reclaim swing thresholds and the tape label clears Bearish.";
  }
  const resolved = regimeFromSpyQqq(spyPct, qqqPct, regimeLabel);
  return `Regime reads ${resolved} on the session tape — desk gates follow index confirmation.`;
}

export function buildScanOutcomePrimaryBlocker(
  qualifiedCount: number,
  sessionVolumeCount: number
): string | null {
  if (qualifiedCount > 0 || sessionVolumeCount === 0) return null;
  return `→ Primary blocker: low volume across ${sessionVolumeCount} symbol${sessionVolumeCount === 1 ? "" : "s"}`;
}

export function buildQuietBridgeLine(
  qualifyingTotal: number,
  nearReadyCount: number,
  regimeLabel: string
): string | null {
  if (qualifyingTotal > 0 || nearReadyCount === 0) return null;
  if (regimeBlocksDesk(regimeLabel)) {
    return `No setups qualified yet → ${nearReadyCount} near-ready blocked by regime / volume`;
  }
  return `No setups qualified yet → ${nearReadyCount} near-ready approaching threshold`;
}

export function buildWhatWouldChangeContent(
  synthesis: ScannerSynthesis | null | undefined,
  regimeLabel: string,
  nearSymbols: string[],
  volumeLeaderSymbols: string[] = []
): WhatWouldChangeContent {
  const watchItems: string[] = [];
  const volLeaders = volumeLeaderSymbols.length
    ? volumeLeaderSymbols
    : (synthesis?.rejection_groups.session_volume ?? [])
        .slice()
        .sort((a, b) => a.pct_below - b.pct_below)
        .slice(0, 2)
        .map((r) => r.symbol);

  const indexProxies = ["SPY", "QQQ"].filter((s) =>
    (synthesis?.rejection_groups.session_volume ?? []).some((r) => r.symbol === s)
  );

  watchItems.push("Participation must improve vs intraday pace");
  if (volLeaders.length > 0) {
    watchItems.push(`Volume expansion in ${volLeaders.join(", ")} first`);
  } else {
    watchItems.push("Volume needs to expand across large caps");
  }
  if (indexProxies.length > 0) {
    watchItems.push(`${indexProxies.join(" / ")} reclaiming pace would confirm a broader turn`);
  } else {
    watchItems.push("SPY / QQQ should lead higher on volume");
  }
  if (regimeBlocksDesk(regimeLabel)) {
    watchItems.push("Regime must clear before swing gates unlock");
  }

  const leadNames = [...new Set([...nearSymbols, ...volLeaders])].slice(0, 2);
  const outcome =
    leadNames.length >= 2
      ? `Volume pickup in ${leadNames[0]} and ${leadNames[1]} would be the first signal that session pace is recovering.`
      : leadNames.length === 1
        ? `Volume pickup in ${leadNames[0]} would be the first signal that session pace is recovering.`
        : "If participation improves → setups may qualify on the next scan.";

  return { watchItems, outcome };
}

/** @deprecated Prefer {@link buildWhatWouldChangeContent} for structured UI. */
export function synthesizeWhatWouldChange(
  synthesis: ScannerSynthesis | null | undefined,
  regimeLabel: string,
  nearSymbols: string[]
): string {
  const base = synthesis?.what_would_change?.trim();
  if (base) return base;
  const { watchItems, outcome } = buildWhatWouldChangeContent(synthesis, regimeLabel, nearSymbols);
  return [...watchItems.map((w) => `• ${w}`), outcome].join(" ");
}

export function marketConditionsRegimeBadge(regimeLabel: string): string {
  return `${regimeLabel} regime`;
}

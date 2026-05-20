import {
  alignmentDisplayMeta,
  layersAwayFromActionable,
  resolveAlignmentDisplayTier
} from "@/lib/alignment-display-tier";
import { regimeFromSpyQqq } from "@/lib/market-context/regime";
import type { ScannerNearQualificationRow, ScannerWatchlistProgressionRow } from "@/lib/scanner-scan-summary";
import type { ScannerSynthesis } from "@/lib/scanner-synthesis";

export type NearReadyMomentum = "improving" | "stable" | "re_eval" | "weakening";

export type NearReadyCardModel = {
  symbol: string;
  desk: "swing" | "day";
  alignmentHeadline: string;
  readinessHint: string;
  confirmedLines: string[];
  blockedLine: string;
  momentum: NearReadyMomentum;
  momentumLabel: string;
  evidenceHref: string;
};

export type DevelopingRowModel = {
  symbol: string;
  desk: "swing" | "day";
  directionLabel: string;
  alignmentLabel: string;
  missingHint: string;
  movement: "improving" | "stable" | "weakening";
  movementSuffix: string;
  watchlistHref: string;
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

function momentumFromRow(
  tier: ReturnType<typeof resolveAlignmentDisplayTier>,
  layersAway: number
): { kind: NearReadyMomentum; label: string } {
  if (tier === "re_evaluating") return { kind: "re_eval", label: "↻ re-eval" };
  if (tier === "near_ready" && layersAway <= 1) return { kind: "improving", label: "↑ improving" };
  if (tier === "developing" && layersAway >= 3) return { kind: "weakening", label: "↓ weakening" };
  return { kind: "stable", label: "→ stable" };
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
      const alignmentHeadline = `${aligned}/${total} aligned`;
      const readinessHint =
        away <= 1 ? `${alignmentHeadline} — Close to ready` : `${alignmentHeadline} — ${away} conditions away`;

      const blockedLine = blocked
        ? "Blocked by regime"
        : away > 0
          ? `${away} layer${away === 1 ? "" : "s"} from actionable`
          : "Awaiting final confirmation";

      const mode = row.desk === "swing" ? "swing" : "day";
      return {
        symbol: row.symbol,
        desk: row.desk,
        alignmentHeadline,
        readinessHint,
        confirmedLines: confirmedLinesForRow(aligned, total, away),
        blockedLine,
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

function movementSuffix(bucket: "improving" | "stable" | "weakening"): string {
  switch (bucket) {
    case "improving":
      return "(+1)";
    case "weakening":
      return "(-1)";
    default:
      return "";
  }
}

export function buildDevelopingMovementGroups(
  rows: ScannerWatchlistProgressionRow[],
  deskFilter: "swing" | "day" | "all",
  excludeSymbols: Set<string>
): DevelopingMovementGroups {
  const filtered = rows.filter((r) => {
    if (excludeSymbols.has(r.symbol)) return false;
    if (deskFilter !== "all" && r.desk !== deskFilter) return false;
    const st = (r.state || "").toLowerCase();
    return !st.includes("actionable");
  });

  const out: DevelopingMovementGroups = { improving: [], stable: [], weakening: [] };

  for (const row of filtered) {
    const aligned = row.layers_aligned ?? 0;
    const total = row.layers_total ?? 6;
    const away = row.layers_away ?? layersAwayFromActionable(aligned, total);
    const bucket = movementBucket(row);
    const dir = (row.label || row.state || "Developing").toLowerCase().includes("short") ? "Short" : "Long";
    const missing =
      away > 0
        ? `Missing: ${away} layer${away === 1 ? "" : "s"} from actionable`
        : "Alignment building";

    const model: DevelopingRowModel = {
      symbol: row.symbol,
      desk: row.desk,
      directionLabel: dir,
      alignmentLabel: `${aligned}/${total} aligned`,
      missingHint: missing,
      movement: bucket,
      movementSuffix: movementSuffix(bucket),
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

export function synthesizeWhatWouldChange(
  synthesis: ScannerSynthesis | null | undefined,
  regimeLabel: string,
  nearSymbols: string[]
): string {
  const base = synthesis?.what_would_change?.trim();
  if (base) return base;
  const names = nearSymbols.slice(0, 2).join(" and ");
  if (regimeBlocksDesk(regimeLabel)) {
    return names
      ? `If the regime clears, ${names} would be first in line to qualify. Check back after the next regular-session scan.`
      : "If SPY and QQQ reclaim session thresholds, swing rows can clear the regime gate on the next scan.";
  }
  return "Session pace or structure needs to firm before setups can qualify.";
}

export function marketConditionsRegimeBadge(regimeLabel: string): string {
  return `${regimeLabel} regime`;
}

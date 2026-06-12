/** Display helpers for the redesigned Setup Evolution tab. */

import type { SetupEvolutionAnalytics, SetupEvolutionScorePoint } from "@/lib/api/setup-evolution";
import { resolveAlignmentDisplayTier, type AlignmentDisplayTier } from "@/lib/alignment-display-tier";

const LAYER_LABELS: Record<string, string> = {
  technical: "Technical",
  news: "News",
  macro: "Macro",
  sector: "Sector",
  geopolitical: "Geopolitical",
  internals: "Internals"
};

export function evolutionLayerLabel(key: string): string {
  return LAYER_LABELS[key.trim().toLowerCase()] ?? key;
}

/** Feed-style state label for journey nodes (Potential / Near / Actionable / Cooling). */
export function evolutionJourneyStateLabel(state: string, layersAligned: number): string {
  const tier = resolveAlignmentDisplayTier({ layersAligned, maturationState: state });
  const map: Record<AlignmentDisplayTier, string> = {
    not_aligned: "Potential",
    developing: "Potential",
    near_ready: "Near",
    actionable: "Actionable",
    invalidated: "Cooling",
    re_evaluating: "Re-evaluating"
  };
  return map[tier];
}

export function formatEvolutionSessionDate(ymd: string): string {
  try {
    const [y, m, d] = ymd.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(dt);
  } catch {
    return ymd;
  }
}

export function formatDurationDays(days: number | null | undefined): string {
  if (days == null || !Number.isFinite(days)) return "—";
  if (days <= 0) return "<1d";
  if (days === 1) return "1d";
  return `${days}d`;
}

export function sparklinePath(
  points: SetupEvolutionScorePoint[],
  width: number,
  height: number,
  padding = 8
): { line: string; dots: Array<{ x: number; y: number; score: number; state: string }> } {
  if (points.length === 0) {
    return { line: "", dots: [] };
  }
  const scores = points.map((p) => p.signal_score);
  const min = 0;
  const max = 100;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;
  const step = points.length <= 1 ? 0 : innerW / (points.length - 1);

  const coords = points.map((p, i) => {
    const x = padding + step * i;
    const y = padding + innerH - ((p.signal_score - min) / (max - min)) * innerH;
    return { x, y, score: p.signal_score, state: p.to_state };
  });

  const line = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  return { line, dots: coords };
}

export function thresholdY(
  threshold: number,
  height: number,
  padding = 8
): number {
  const innerH = height - padding * 2;
  return padding + innerH - (threshold / 100) * innerH;
}

export function dotColorForState(
  state: string,
  colors: { bullish: string; caution: string; bearish: string; textMuted: string }
): string {
  const tier = resolveAlignmentDisplayTier({ layersAligned: 3, maturationState: state });
  if (tier === "actionable") return colors.bullish;
  if (tier === "near_ready") return colors.caution;
  if (tier === "invalidated" || tier === "re_evaluating") return colors.textMuted;
  return colors.textMuted;
}

export function layerStabilityBandLabel(band: string): string {
  if (band === "consistent") return "Consistently aligned";
  if (band === "intermittent") return "Intermittent";
  return "Not confirming";
}

export function inflectionStreakLine(
  analytics: SetupEvolutionAnalytics | undefined,
  stateLabel: string
): string | null {
  const days = analytics?.inflection?.current_state_streak_days;
  if (days == null) return null;
  return `In current state: ${days} day${days === 1 ? "" : "s"} (${stateLabel})`;
}

export function groupTimelineByWeek(
  rows: NonNullable<SetupEvolutionAnalytics["score_timeline"]>
): Array<{ weekKey: string; label: string; rows: typeof rows }> {
  const buckets = new Map<string, typeof rows>();
  for (const row of rows) {
    const d = new Date(`${row.session_date}T12:00:00`);
    const onejan = new Date(d.getFullYear(), 0, 1);
    const week = Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7);
    const key = `${d.getFullYear()}-W${week}`;
    const existing = buckets.get(key) ?? [];
    existing.push(row);
    buckets.set(key, existing);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekKey, weekRows]) => ({
      weekKey,
      label: `Week of ${formatEvolutionSessionDate(weekRows[0]?.session_date ?? "")}`,
      rows: weekRows
    }));
}

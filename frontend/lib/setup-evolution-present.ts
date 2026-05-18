/** Copy + formatting for setup evolution (Past States) UI. */

import type { SetupEvolutionTransition } from "@/lib/api/setup-evolution";
import { alignmentDisplayMeta, formatAlignmentStatusLine } from "@/lib/alignment-display-tier";

export function formatMaturationStateLine(
  state: string,
  layersAligned: number,
  layersTotal: number
): string {
  return formatAlignmentStatusLine({
    layersAligned,
    layersTotal,
    maturationState: state
  });
}

export function formatTransitionTimelineRow(t: SetupEvolutionTransition): {
  dateLabel: string;
  line: string;
  dot: string;
} {
  const d = t.session_date || t.recorded_at.slice(0, 10);
  const dateLabel = formatShortDate(d);
  const line = formatMaturationStateLine(t.to_state, t.layers_aligned, t.layers_total);
  const dot =
    alignmentDisplayMeta({
      layersAligned: t.layers_aligned,
      layersTotal: t.layers_total,
      maturationState: t.to_state
    }).emoji || "•";
  return { dateLabel, line, dot };
}

function formatShortDate(ymd: string): string {
  try {
    const [y, m, day] = ymd.split("-").map(Number);
    const dt = new Date(y, m - 1, day);
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(dt);
  } catch {
    return ymd;
  }
}

export function formatStartedTracking(iso: string | null | undefined): string | null {
  if (!iso?.trim()) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    }).format(d);
  } catch {
    return null;
  }
}

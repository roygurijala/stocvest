/** Copy + formatting for setup evolution (Past States) UI. */

import type { SetupEvolutionTransition } from "@/lib/api/setup-evolution";

const STATE_LABEL: Record<string, string> = {
  not_aligned: "Not aligned",
  developing: "Developing",
  actionable: "Actionable",
  invalidated: "Invalidated",
  re_evaluating: "Re-evaluating"
};

const STATE_DOT: Record<string, string> = {
  not_aligned: "🔴",
  developing: "🟠",
  actionable: "🟢",
  invalidated: "⚫",
  re_evaluating: "🔵"
};

export function formatMaturationStateLine(
  state: string,
  layersAligned: number,
  layersTotal: number
): string {
  const label = STATE_LABEL[state] ?? state;
  if (state === "developing" || state === "re_evaluating" || state === "actionable") {
    return `${label} (${layersAligned}/${layersTotal})`;
  }
  return label;
}

export function formatTransitionTimelineRow(t: SetupEvolutionTransition): {
  dateLabel: string;
  line: string;
  dot: string;
} {
  const d = t.session_date || t.recorded_at.slice(0, 10);
  const dateLabel = formatShortDate(d);
  const line = formatMaturationStateLine(t.to_state, t.layers_aligned, t.layers_total);
  const dot = STATE_DOT[t.to_state] ?? "•";
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

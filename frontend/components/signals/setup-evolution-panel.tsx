"use client";

import { useEffect, useState } from "react";
import { fetchSetupEvolution, type SetupEvolutionResponse } from "@/lib/api/setup-evolution";
import {
  formatMaturationStateLine,
  formatStartedTracking,
  formatTransitionTimelineRow
} from "@/lib/setup-evolution-present";
import { EMPTY_SETUP_EVOLUTION } from "@/lib/product-empty-states";
import { borderRadius, spacing, surfaceGlowClassName } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  symbol: string;
  tradingMode: "swing" | "day";
  /** Show summary stat cards (hub page). */
  showSummary?: boolean;
};

export function SetupEvolutionPanel({ symbol, tradingMode, showSummary = false }: Props) {
  const { colors } = useTheme();
  const [data, setData] = useState<SetupEvolutionResponse | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    setData(undefined);
    void fetchSetupEvolution(symbol, tradingMode).then((res) => {
      if (active) setData(res);
    });
    return () => {
      active = false;
    };
  }, [symbol, tradingMode]);

  const symU = symbol.trim().toUpperCase();
  const started = formatStartedTracking(data?.started_tracking_at ?? null);
  const hasTransitions = (data?.transitions?.length ?? 0) > 0;
  const summary = data?.summary;

  return (
    <section
      className={surfaceGlowClassName}
      data-testid="setup-evolution-panel"
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.xl,
        padding: spacing[4]
      }}
    >
      <p
        className="m-0 text-[10px] font-semibold uppercase tracking-[0.14em]"
        style={{ color: colors.textMuted }}
      >
        Past states
      </p>
      <h2 className="m-0 mt-2 text-lg font-semibold" style={{ color: colors.text }}>
        Setup evolution — {symU}
      </h2>

      {data === undefined ? (
        <p className="mt-3 text-sm" style={{ color: colors.textMuted }}>
          Loading setup history…
        </p>
      ) : data === null ? (
        <p className="mt-3 text-sm" style={{ color: colors.textMuted }}>
          Add {symU} to your default watchlist to track setup evolution over time.
        </p>
      ) : (
        <>
          {started ? (
            <p className="m-0 mt-2 text-sm" style={{ color: colors.textMuted }}>
              Started tracking: {started}
            </p>
          ) : null}
          <p className="m-0 mt-1 text-sm" style={{ color: colors.textMuted }}>
            {data.evaluation_cadence}
          </p>

          {showSummary && summary ? (
            <div
              className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
              data-testid="setup-evolution-summary"
            >
              <SummaryTile label="Days tracked" value={String(summary.days_tracked)} colors={colors} />
              <SummaryTile
                label="Latest state"
                value={
                  summary.latest_state
                    ? formatMaturationStateLine(
                        summary.latest_state,
                        summary.latest_layers_aligned ?? 0,
                        6
                      )
                    : "—"
                }
                colors={colors}
              />
              <SummaryTile
                label="Improved"
                value={String(summary.transition_counts.improved)}
                colors={colors}
              />
              <SummaryTile
                label="Weakened"
                value={String(summary.transition_counts.worsened)}
                colors={colors}
              />
            </div>
          ) : null}

          {!hasTransitions ? (
            <div className="mt-4" data-testid="setup-evolution-warming">
              <p className="m-0 text-sm font-semibold" style={{ color: colors.text }}>
                {EMPTY_SETUP_EVOLUTION.title}
              </p>
              <p className="m-0 mt-2 text-sm leading-relaxed" style={{ color: colors.textMuted }}>
                {EMPTY_SETUP_EVOLUTION.body}
              </p>
              <p className="m-0 mt-2 text-xs leading-relaxed" style={{ color: colors.textMuted }}>
                {EMPTY_SETUP_EVOLUTION.cadence}
              </p>
            </div>
          ) : (
            <ul className="mt-4 list-none space-y-2 p-0" data-testid="setup-evolution-timeline">
              {data.transitions.map((t) => {
                const row = formatTransitionTimelineRow(t);
                return (
                  <li
                    key={`${t.recorded_at}-${t.to_state}-${t.layers_aligned}`}
                    className="flex gap-3 text-sm"
                    style={{ color: colors.text }}
                  >
                    <span className="w-14 shrink-0 tabular-nums" style={{ color: colors.textMuted }}>
                      {row.dateLabel}
                    </span>
                    <span aria-hidden>{row.dot}</span>
                    <span>{row.line}</span>
                    {t.transition_type !== "unchanged" ? (
                      <span className="text-xs capitalize" style={{ color: colors.textMuted }}>
                        ({t.transition_type})
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function SummaryTile({
  label,
  value,
  colors
}: {
  label: string;
  value: string;
  colors: { surfaceMuted: string; text: string; textMuted: string };
}) {
  return (
    <div
      style={{
        background: colors.surfaceMuted,
        borderRadius: borderRadius.md,
        padding: spacing[2]
      }}
    >
      <p className="m-0 text-[10px] font-semibold uppercase tracking-wide" style={{ color: colors.textMuted }}>
        {label}
      </p>
      <p className="m-0 mt-1 text-sm font-semibold" style={{ color: colors.text }}>
        {value}
      </p>
    </div>
  );
}

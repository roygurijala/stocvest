"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  fetchSetupEvolution,
  type SetupEvolutionAnalytics,
  type SetupEvolutionResponse
} from "@/lib/api/setup-evolution";
import { formatStartedTracking } from "@/lib/setup-evolution-present";
import {
  dotColorForState,
  evolutionJourneyStateLabel,
  evolutionLayerLabel,
  formatDurationDays,
  formatEvolutionSessionDate,
  groupTimelineByWeek,
  inflectionStreakLine,
  layerStabilityBandLabel,
  sparklinePath,
  thresholdY
} from "@/lib/setup-evolution-analytics";
import { MATURATION_PROGRESSION_EXPECTATION_LINE } from "@/lib/maturation-expected-frequency";
import { EMPTY_SETUP_EVOLUTION } from "@/lib/product-empty-states";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import { WATCHLIST_SYMBOLS_CHANGED_EVENT } from "@/lib/watchlist-membership-client";
import { WATCHLIST_MATURATION_UPDATED_EVENT } from "@/lib/watchlist-maturation-bump";

type Props = {
  symbol: string;
  tradingMode: "swing" | "day";
  /** Show summary stat cards (hub page). */
  showSummary?: boolean;
};

export function SetupEvolutionPanel({ symbol, tradingMode, showSummary: _showSummary = false }: Props) {
  const { colors } = useTheme();
  const [data, setData] = useState<SetupEvolutionResponse | null | undefined>(undefined);
  const requestIdRef = useRef(0);

  const reload = useCallback(() => {
    const symU = symbol.trim().toUpperCase();
    if (!symU) {
      setData(null);
      return;
    }
    const id = ++requestIdRef.current;
    setData(undefined);
    void fetchSetupEvolution(symU, tradingMode).then((res) => {
      if (requestIdRef.current === id) setData(res);
    });
  }, [symbol, tradingMode]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    const symU = symbol.trim().toUpperCase();
    if (!symU) return;

    const onSymbolsChanged = () => reload();
    const onMaturationUpdated = (e: Event) => {
      const detail = (e as CustomEvent<{ symbol?: string; mode?: string }>).detail;
      if (detail?.symbol?.trim().toUpperCase() === symU && detail?.mode === tradingMode) {
        reload();
      }
    };

    window.addEventListener(WATCHLIST_SYMBOLS_CHANGED_EVENT, onSymbolsChanged);
    window.addEventListener(WATCHLIST_MATURATION_UPDATED_EVENT, onMaturationUpdated);
    return () => {
      window.removeEventListener(WATCHLIST_SYMBOLS_CHANGED_EVENT, onSymbolsChanged);
      window.removeEventListener(WATCHLIST_MATURATION_UPDATED_EVENT, onMaturationUpdated);
    };
  }, [symbol, tradingMode, reload]);

  const symU = symbol.trim().toUpperCase();
  const started = formatStartedTracking(data?.started_tracking_at ?? null);
  const analytics = data?.analytics;
  const hasHistory =
    (analytics?.score_trend?.length ?? 0) > 0 || (data?.transitions?.length ?? 0) > 0;

  return (
    <section
      className={surfaceGlowClassName}
      data-testid="setup-evolution-panel"
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.xl,
        padding: spacing[4],
        display: "flex",
        flexDirection: "column",
        gap: spacing[4]
      }}
    >
      <header>
        <p
          className="m-0 text-[10px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: colors.textMuted }}
        >
          Setup evolution
        </p>
        <h2 className="m-0 mt-2 text-lg font-semibold" style={{ color: colors.text }}>
          {symU} · {tradingMode === "day" ? "Day" : "Swing"}
        </h2>
        {started ? (
          <p className="m-0 mt-2 text-sm" style={{ color: colors.textMuted }}>
            Started tracking: {started}
          </p>
        ) : null}
      </header>

      {data === undefined ? (
        <p className="text-sm" style={{ color: colors.textMuted }}>
          Loading setup history…
        </p>
      ) : data === null ? (
        <p className="text-sm" style={{ color: colors.textMuted }}>
          Add {symU} to your default watchlist to track setup evolution over time.
        </p>
      ) : !hasHistory ? (
        <div data-testid="setup-evolution-warming">
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
        <>
          {analytics ? <StateJourney analytics={analytics} colors={colors} /> : null}
          {analytics ? <ScoreSparkline analytics={analytics} colors={colors} /> : null}
          {analytics ? <InflectionRow analytics={analytics} colors={colors} /> : null}
          {analytics?.forward_projection ? (
            <ForwardProjectionCard projection={analytics.forward_projection} colors={colors} />
          ) : null}
          {analytics?.layer_stability?.length ? (
            <LayerStabilityBlock layers={analytics.layer_stability} colors={colors} symbol={symU} />
          ) : null}
          {analytics?.score_timeline?.length ? (
            <ScoreTimeline timeline={analytics.score_timeline} colors={colors} />
          ) : null}
        </>
      )}

      {data && data !== null ? (
        <p
          className="m-0 text-xs leading-relaxed"
          style={{ color: colors.textMuted }}
          data-testid="setup-evolution-progression-expectation"
        >
          {MATURATION_PROGRESSION_EXPECTATION_LINE}
        </p>
      ) : null}
    </section>
  );
}

function StateJourney({
  analytics,
  colors
}: {
  analytics: SetupEvolutionAnalytics;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const segments = analytics.state_journey;
  if (!segments.length) return null;

  return (
    <div data-testid="setup-evolution-journey">
      <SectionLabel colors={colors}>Where is this setup now?</SectionLabel>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: spacing[2],
          marginTop: spacing[2]
        }}
      >
        {segments.map((seg, idx) => {
          const layers = seg.entry_layers_aligned ?? 0;
          const label = evolutionJourneyStateLabel(seg.state, layers);
          const isLast = idx === segments.length - 1;
          return (
            <div key={`${seg.started_session}-${seg.state}`} style={{ display: "flex", alignItems: "center", gap: spacing[2] }}>
              <div
                style={{
                  padding: `${spacing[2]} ${spacing[3]}`,
                  borderRadius: borderRadius.md,
                  border: `1px solid ${seg.is_current ? colors.accent : colors.border}`,
                  background: seg.is_current ? `${colors.accent}12` : colors.surfaceMuted,
                  minWidth: 88
                }}
              >
                <p className="m-0 text-xs font-bold" style={{ color: colors.text }}>
                  {label}
                </p>
                <p className="m-0 mt-1 text-[10px]" style={{ color: colors.textMuted }}>
                  {formatEvolutionSessionDate(seg.started_session)}
                </p>
                <p className="m-0 mt-0.5 text-[10px] font-semibold tabular-nums" style={{ color: colors.text }}>
                  score {seg.is_current && seg.current_score != null ? seg.current_score : seg.entry_score}
                </p>
                {seg.duration_days != null ? (
                  <p className="m-0 mt-0.5 text-[10px]" style={{ color: colors.textMuted }}>
                    {formatDurationDays(seg.duration_days)} in state
                  </p>
                ) : null}
              </div>
              {!isLast ? (
                <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>
                  ──{formatDurationDays(
                    segments[idx + 1]
                      ? _daysBetween(seg.started_session, segments[idx + 1].started_session)
                      : null
                  )}──▶
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function _daysBetween(start: string, end: string): number | null {
  try {
    const a = new Date(`${start}T12:00:00`).getTime();
    const b = new Date(`${end}T12:00:00`).getTime();
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return Math.max(0, Math.round((b - a) / 86400000));
  } catch {
    return null;
  }
}

function ScoreSparkline({
  analytics,
  colors
}: {
  analytics: SetupEvolutionAnalytics;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const points = analytics.score_trend;
  const width = 320;
  const height = 96;
  const threshold = analytics.actionable_score_threshold;
  const { line, dots } = useMemo(() => sparklinePath(points, width, height), [points]);
  const threshY = thresholdY(threshold, height);

  return (
    <div data-testid="setup-evolution-sparkline">
      <SectionLabel colors={colors}>Is it getting stronger or weaker?</SectionLabel>
      <div
        style={{
          marginTop: spacing[2],
          padding: spacing[3],
          borderRadius: borderRadius.md,
          border: `1px solid ${colors.border}`,
          background: colors.surfaceMuted
        }}
      >
        <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Score trend sparkline">
          <line
            x1={8}
            y1={threshY}
            x2={width - 8}
            y2={threshY}
            stroke={colors.caution}
            strokeDasharray="4 3"
            strokeWidth={1}
          />
          <text x={width - 8} y={threshY - 4} textAnchor="end" fontSize={9} fill={colors.textMuted}>
            Actionable {threshold}
          </text>
          {line ? <path d={line} fill="none" stroke={colors.accent} strokeWidth={2} /> : null}
          {dots.map((d, i) => (
            <circle
              key={`${d.x}-${i}`}
              cx={d.x}
              cy={d.y}
              r={4}
              fill={dotColorForState(d.state, colors)}
            />
          ))}
        </svg>
        <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[3], marginTop: spacing[2] }}>
          {points.slice(-4).map((p) => (
            <span key={p.session_date} style={{ fontSize: 10, color: colors.textMuted }}>
              {formatEvolutionSessionDate(p.session_date)} · {p.signal_score}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function InflectionRow({
  analytics,
  colors
}: {
  analytics: SetupEvolutionAnalytics;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const inf = analytics.inflection;
  const lines = [
    inf.peak?.label,
    inf.biggest_jump?.label,
    inflectionStreakLine(
      analytics,
      evolutionJourneyStateLabel(
        inf.current_state ?? "",
        analytics.state_journey.find((s) => s.is_current)?.entry_layers_aligned ?? 0
      )
    ),
    inf.momentum?.label
  ].filter(Boolean) as string[];

  if (!lines.length) return null;

  return (
    <div
      data-testid="setup-evolution-inflection"
      style={{
        display: "grid",
        gap: spacing[2],
        gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))"
      }}
    >
      {lines.map((line) => (
        <p
          key={line}
          className="m-0 text-sm leading-snug"
          style={{
            color: colors.text,
            padding: spacing[2],
            borderRadius: borderRadius.sm,
            background: colors.surfaceMuted,
            border: `1px solid ${colors.border}`
          }}
        >
          {line}
        </p>
      ))}
    </div>
  );
}

function ForwardProjectionCard({
  projection,
  colors
}: {
  projection: NonNullable<SetupEvolutionAnalytics["forward_projection"]>;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  return (
    <div
      data-testid="setup-evolution-projection"
      style={{
        padding: spacing[3],
        borderRadius: borderRadius.md,
        border: `1px solid ${colors.border}`,
        borderLeft: `3px solid ${colors.accent}`
      }}
    >
      <SectionLabel colors={colors}>Forward look (extrapolation)</SectionLabel>
      <p className="m-0 mt-2 text-sm leading-relaxed" style={{ color: colors.text }}>
        {projection.label}
      </p>
      <p className="m-0 mt-1 text-xs" style={{ color: colors.textMuted }}>
        {projection.disclaimer}
      </p>
    </div>
  );
}

function LayerStabilityBlock({
  layers,
  colors,
  symbol
}: {
  layers: NonNullable<SetupEvolutionAnalytics["layer_stability"]>;
  colors: ReturnType<typeof useTheme>["colors"];
  symbol: string;
}) {
  const groups = {
    consistent: layers.filter((l) => l.band === "consistent"),
    intermittent: layers.filter((l) => l.band === "intermittent"),
    not_confirming: layers.filter((l) => l.band === "not_confirming")
  };

  return (
    <div data-testid="setup-evolution-layer-stability">
      <SectionLabel colors={colors}>Why is it behaving this way?</SectionLabel>
      <p className="m-0 mt-1 text-xs" style={{ color: colors.textMuted }}>
        Layer stability — {symbol} (last {layers[0]?.total_sessions ?? 0} sessions)
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: spacing[3], marginTop: spacing[3] }}>
        {(
          [
            ["consistent", "Consistently aligned", colors.bullish],
            ["intermittent", "Intermittent", colors.caution],
            ["not_confirming", "Not confirming", colors.textMuted]
          ] as const
        ).map(([key, title, tone]) => {
          const list = groups[key];
          if (!list.length) return null;
          return (
            <div key={key}>
              <p className="m-0 text-xs font-semibold uppercase tracking-wide" style={{ color: tone }}>
                {title}
              </p>
              <ul className="m-0 mt-2 list-none space-y-2 p-0">
                {list.map((layer) => (
                  <li key={layer.layer} style={{ fontSize: typography.scale.sm, color: colors.text }}>
                    <span style={{ fontWeight: 600 }}>{evolutionLayerLabel(layer.layer)}</span>
                    <span style={{ marginLeft: 8, fontFamily: "monospace", letterSpacing: 1 }}>{layer.pattern}</span>
                    <span style={{ marginLeft: 8, fontSize: typography.scale.xs, color: colors.textMuted }}>
                      {layerStabilityBandLabel(layer.band)}
                      {layer.hint ? ` — ${layer.hint}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScoreTimeline({
  timeline,
  colors
}: {
  timeline: NonNullable<SetupEvolutionAnalytics["score_timeline"]>;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const [openWeeks, setOpenWeeks] = useState<Record<string, boolean>>({});
  const weeks = useMemo(() => groupTimelineByWeek(timeline), [timeline]);

  return (
    <div data-testid="setup-evolution-timeline">
      <SectionLabel colors={colors}>Daily score narrative</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: spacing[2], marginTop: spacing[2] }}>
        {weeks.map((week) => {
          const open = openWeeks[week.weekKey] ?? true;
          return (
            <div
              key={week.weekKey}
              style={{
                border: `1px solid ${colors.border}`,
                borderRadius: borderRadius.md,
                overflow: "hidden"
              }}
            >
              <button
                type="button"
                onClick={() => setOpenWeeks((prev) => ({ ...prev, [week.weekKey]: !open }))}
                style={{
                  width: "100%",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: `${spacing[2]} ${spacing[3]}`,
                  border: "none",
                  background: colors.surfaceMuted,
                  color: colors.text,
                  fontSize: typography.scale.xs,
                  fontWeight: 600,
                  cursor: "pointer",
                  textAlign: "left"
                }}
              >
                <span>{week.label}</span>
                <span>{open ? "▾" : "▸"}</span>
              </button>
              {open ? (
                <ul className="m-0 list-none space-y-0 p-0">
                  {week.rows.map((row) => (
                    <li
                      key={row.session_date}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "4.5rem 1.5rem 4rem 1fr",
                        gap: spacing[2],
                        padding: `${spacing[2]} ${spacing[3]}`,
                        borderTop: `1px solid ${colors.border}`,
                        fontSize: typography.scale.sm,
                        color: colors.text,
                        alignItems: "start"
                      }}
                    >
                      <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>
                        {formatEvolutionSessionDate(row.session_date)}
                      </span>
                      <span
                        aria-hidden
                        style={{
                          color: row.state_changed
                            ? colors.caution
                            : row.score_delta != null && row.score_delta > 0
                              ? colors.bullish
                              : row.score_delta != null && row.score_delta < 0
                                ? colors.bearish
                                : colors.textMuted
                        }}
                      >
                        {row.dot}
                      </span>
                      <span style={{ fontWeight: 600, color: row.score_delta != null && row.score_delta < 0 ? colors.bearish : row.score_delta != null && row.score_delta > 0 ? colors.bullish : colors.textMuted }}>
                        {row.delta_label}
                      </span>
                      <span>
                        <span style={{ fontWeight: 600 }}>score {row.signal_score}</span>
                        {" · "}
                        {evolutionJourneyStateLabel(row.to_state, row.layers_aligned ?? 0)}
                        {row.state_changed ? " · state change" : ""}
                        <span style={{ display: "block", fontSize: typography.scale.xs, color: colors.textMuted, marginTop: 2 }}>
                          {row.summary}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SectionLabel({
  children,
  colors
}: {
  children: ReactNode;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  return (
    <p
      className="m-0 text-[10px] font-semibold uppercase tracking-[0.14em]"
      style={{ color: colors.textMuted }}
    >
      {children}
    </p>
  );
}

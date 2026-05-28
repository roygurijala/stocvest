"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  MARKET_CONTEXT_INDEX_FOOTNOTE,
  type MarketContextPill,
  type MarketContextSnapshot
} from "@/lib/market-context/snapshot";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  snapshot: MarketContextSnapshot;
  /** When true, omit duplicate environment summary (hero already shows it). */
  embedded?: boolean;
};

function pillColors(tone: MarketContextPill["tone"], colors: ReturnType<typeof useTheme>["colors"]) {
  switch (tone) {
    case "bullish":
      return { fg: colors.bullish, bg: "rgba(34,197,94,0.12)", border: "rgba(34,197,94,0.35)" };
    case "bearish":
      return { fg: colors.bearish, bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.35)" };
    case "caution":
      return { fg: colors.caution, bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.35)" };
    default:
      return { fg: colors.textMuted, bg: "rgba(148,163,184,0.08)", border: colors.border };
  }
}

export function DashboardMarketContextPanel({ snapshot, embedded = false }: Props) {
  const { colors } = useTheme();
  const body = (
    <DashboardMarketContextPanelBody snapshot={snapshot} showSummary={!embedded} showSessionToday={!embedded} />
  );
  if (embedded) {
    return (
      <div role="group" aria-label="Market context detail" data-testid="dashboard-market-context">
        {body}
      </div>
    );
  }

  return (
    <section
      role="region"
      aria-label="Market context"
      data-testid="dashboard-market-context"
      className={surfaceGlowClassName}
      style={{
        borderRadius: borderRadius.lg,
        border: `1px solid ${colors.border}`,
        background: colors.surface,
        padding: spacing[4]
      }}
    >
      <p
        style={{
          margin: `0 0 ${spacing[3]}`,
          fontSize: typography.scale.xs,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: colors.textMuted
        }}
      >
        Market context
      </p>
      {body}
    </section>
  );
}

export function DashboardMarketContextPanelBody({
  snapshot,
  showSummary = true,
  showSessionToday = true
}: {
  snapshot: MarketContextSnapshot;
  showSummary?: boolean;
  showSessionToday?: boolean;
}) {
  const { colors } = useTheme();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <>
      <div
        className="grid gap-2 sm:grid-cols-3"
        data-testid="dashboard-market-context-index-stats"
      >
        {snapshot.indexStats.map((stat) => {
          const toneColor =
            stat.tone === "bullish"
              ? colors.bullish
              : stat.tone === "bearish"
                ? colors.bearish
                : colors.textMuted;
          return (
            <div
              key={stat.symbol}
              data-testid={`dashboard-market-index-${stat.symbol}`}
              style={{
                borderRadius: borderRadius.md,
                border: `1px solid ${colors.border}`,
                padding: spacing[3],
                background: `color-mix(in srgb, ${colors.surface} 96%, ${toneColor} 4%)`
              }}
            >
              <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted }}>
                {stat.symbol} · {stat.label}
              </p>
              <p
                style={{
                  margin: `${spacing[1]} 0 0`,
                  fontSize: typography.scale.lg,
                  fontWeight: 700,
                  fontVariantNumeric: "tabular-nums",
                  color: toneColor
                }}
              >
                {stat.formattedPct}
              </p>
            </div>
          );
        })}
      </div>
      <p style={{ margin: `${spacing[2]} 0 ${spacing[2]}`, fontSize: typography.scale.xs, color: colors.textMuted }}>
        {MARKET_CONTEXT_INDEX_FOOTNOTE}
      </p>

      {showSessionToday && snapshot.sessionToday.items.length > 0 ? (
        <div
          data-testid="dashboard-market-context-today"
          style={{
            marginBottom: spacing[3],
            padding: spacing[3],
            borderRadius: borderRadius.md,
            border: `1px solid color-mix(in srgb, ${colors.accent} 25%, ${colors.border})`,
            background: `color-mix(in srgb, ${colors.surface} 94%, ${colors.accent} 6%)`
          }}
        >
          <p
            style={{
              margin: `0 0 ${spacing[2]}`,
              fontSize: typography.scale.xs,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: colors.textMuted
            }}
          >
            {snapshot.sessionToday.label}
          </p>
          <p
            style={{
              margin: 0,
              fontSize: typography.scale.sm,
              fontWeight: 600,
              fontVariantNumeric: "tabular-nums",
              color: colors.text,
              lineHeight: 1.5
            }}
          >
            {snapshot.sessionToday.items.map((item, i) => {
              const toneColor =
                item.tone === "bullish"
                  ? colors.bullish
                  : item.tone === "bearish"
                    ? colors.bearish
                    : colors.textMuted;
              return (
                <span key={item.symbol}>
                  {i > 0 ? "   " : null}
                  <span style={{ color: colors.textMuted, fontWeight: 500 }}>{item.symbol}</span>{" "}
                  <span style={{ color: toneColor }}>{item.formattedPct}</span>
                </span>
              );
            })}
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2" data-testid="dashboard-market-context-pills">
        {snapshot.pills.map((pill) => (
          <MarketContextPillButton
            key={pill.id}
            pill={pill}
            expanded={expandedId === pill.id}
            onToggle={() => setExpandedId((cur) => (cur === pill.id ? null : pill.id))}
          />
        ))}
      </div>

      {expandedId ? (
        <MarketContextExplainPanel
          pill={snapshot.pills.find((p) => p.id === expandedId)!}
          onClose={() => setExpandedId(null)}
        />
      ) : null}

      {showSummary ? (
        <p
          data-testid="dashboard-market-context-summary"
          style={{
            margin: `${spacing[3]} 0 0`,
            fontSize: typography.scale.sm,
            color: colors.textMuted,
            lineHeight: 1.5
          }}
        >
          {snapshot.environmentSummary}
        </p>
      ) : null}
    </>
  );
}

function MarketContextPillButton({
  pill,
  expanded,
  onToggle
}: {
  pill: MarketContextPill;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { colors } = useTheme();
  const pal = pillColors(pill.tone, colors);

  return (
    <button
      type="button"
      data-testid={`dashboard-market-pill-${pill.id}`}
      aria-expanded={expanded}
      onClick={onToggle}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 12px",
        borderRadius: borderRadius.full,
        border: `1px solid ${pal.border}`,
        background: pal.bg,
        color: pal.fg,
        fontSize: typography.scale.xs,
        fontWeight: 600,
        cursor: "pointer"
      }}
    >
      {pill.category}: {pill.value}
      {expanded ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
    </button>
  );
}

function MarketContextExplainPanel({ pill, onClose }: { pill: MarketContextPill; onClose: () => void }) {
  const { colors } = useTheme();
  const structured = pill.structured;

  return (
    <div
      data-testid={`dashboard-market-explain-${pill.id}`}
      style={{
        marginTop: spacing[3],
        borderRadius: borderRadius.md,
        border: `1px dashed color-mix(in srgb, ${colors.border} 80%, ${colors.accent} 20%)`,
        background: `color-mix(in srgb, ${colors.surface} 92%, ${colors.accent} 8%)`,
        padding: spacing[3]
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p style={{ margin: 0, fontSize: typography.scale.sm, fontWeight: 700, color: colors.text }}>
          How we read {pill.category.toLowerCase()}
        </p>
        <button
          type="button"
          onClick={onClose}
          style={{
            fontSize: typography.scale.xs,
            color: colors.textMuted,
            background: "transparent",
            border: "none",
            cursor: "pointer"
          }}
        >
          Close
        </button>
      </div>

      {structured ? (
        <div style={{ marginTop: spacing[2], display: "grid", gap: spacing[3] }}>
          <div>
            <p
              style={{
                margin: `0 0 ${spacing[1]}`,
                fontSize: typography.scale.xs,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: colors.textMuted
              }}
            >
              Why
            </p>
            <ul
              style={{
                margin: 0,
                paddingLeft: spacing[4],
                fontSize: typography.scale.sm,
                color: colors.text,
                lineHeight: 1.55
              }}
            >
              {structured.why.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <div>
            <p
              style={{
                margin: `0 0 ${spacing[1]}`,
                fontSize: typography.scale.xs,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: colors.textMuted
              }}
            >
              Result
            </p>
            <p style={{ margin: 0, fontSize: typography.scale.sm, fontWeight: 600, color: colors.text }}>
              {structured.result}
            </p>
          </div>
          <div>
            <p
              style={{
                margin: `0 0 ${spacing[1]}`,
                fontSize: typography.scale.xs,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: colors.textMuted
              }}
            >
              Impact
            </p>
            <ul
              style={{
                margin: 0,
                paddingLeft: spacing[4],
                fontSize: typography.scale.sm,
                color: colors.textMuted,
                lineHeight: 1.55
              }}
            >
              {structured.impact.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          {structured.advanced ? (
            <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.45 }}>
              <strong style={{ color: colors.text }}>Advanced: </strong>
              {structured.advanced}
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <p style={{ margin: `${spacing[2]} 0`, fontSize: typography.scale.sm, color: colors.text, lineHeight: 1.5 }}>
            {pill.summaryLine}
          </p>
          {pill.inputs.length > 0 ? (
            <dl style={{ margin: `${spacing[2]} 0`, display: "grid", gap: spacing[1] }}>
              {pill.inputs.map((row) => (
                <div key={row.label} className="flex flex-wrap gap-x-2 text-sm">
                  <dt style={{ color: colors.textMuted, fontWeight: 600 }}>{row.label}</dt>
                  <dd style={{ margin: 0, color: colors.text }}>{row.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {pill.rule ? (
            <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.45 }}>
              <strong style={{ color: colors.text }}>Rule: </strong>
              {pill.rule}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

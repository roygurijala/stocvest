"use client";

import { memo, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowRight, CheckCircle, ChevronDown, ExternalLink, LineChart, XCircle } from "lucide-react";
import type { ThemeColors } from "@/lib/design-system";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { SymbolName } from "@/components/symbol-name";
import type {
  AssistantAction,
  AssistantChart,
  AssistantChartLevel,
  AssistantCitation,
  AssistantClarify,
  AssistantDiscovery,
  AssistantMessage
} from "@/lib/assistant/types";

// Lazy-loaded so TradingView's lightweight-charts (~35 KB) only ships when a
// user actually expands a full chart — the chat stays featherweight.
const FullPriceChart = dynamic(
  () => import("./full-price-chart").then((m) => m.FullPriceChart),
  { ssr: false }
);

/**
 * No-bubble vertical timeline for STOCVEST Assistant turns.
 *
 * Distinguishing details (the "calm authority" look):
 * - a thin gradient rail down the left edge
 * - speaker nodes are small filled circles on the rail
 * - speaker labels are 10px uppercase tracking-wide, deliberately quiet
 * - assistant messages render with a per-word fade-in for the most recent turn
 * - no chat bubbles, no emoji, no balloon tails — this is meant to read like a calm log
 */
interface AssistantConversationRailProps {
  messages: AssistantMessage[];
  colors: ThemeColors;
  /** Tone driving the assistant node color when contextual: caution / bullish / bearish / neutral. */
  contextTone: "neutral" | "bullish" | "bearish" | "caution";
  /** True while a turn is in flight — disables clarifying quick-reply chips. */
  loading?: boolean;
  /** Send a refining message when a clarifying quick-reply chip is tapped. */
  onQuickReply?: (text: string) => void;
}

function nodeColor(
  role: AssistantMessage["role"],
  colors: ThemeColors,
  contextTone: AssistantConversationRailProps["contextTone"]
): string {
  if (role === "user") return colors.accent;
  if (contextTone === "bullish") return colors.bullish;
  if (contextTone === "bearish") return colors.bearish;
  if (contextTone === "caution") return colors.caution;
  return colors.textMuted;
}

function speakerLabel(role: AssistantMessage["role"]): string {
  return role === "user" ? "YOU" : "STOCVEST";
}

export const AssistantConversationRail = memo(function AssistantConversationRail({
  messages,
  colors,
  contextTone,
  loading,
  onQuickReply
}: AssistantConversationRailProps) {
  return (
    <ol
      style={{
        position: "relative",
        listStyle: "none",
        padding: 0,
        margin: 0,
        display: "grid",
        gap: spacing[4]
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: 7,
          top: 8,
          bottom: 8,
          width: 2,
          background:
            "linear-gradient(180deg, rgba(56,189,248,0.0) 0%, rgba(56,189,248,0.38) 18%, rgba(56,189,248,0.38) 82%, rgba(56,189,248,0.0) 100%)",
          borderRadius: 2,
          pointerEvents: "none"
        }}
      />
      {messages.map((m) => (
        <ConversationRow
          key={m.id}
          message={m}
          colors={colors}
          contextTone={contextTone}
          loading={loading}
          onQuickReply={onQuickReply}
        />
      ))}
    </ol>
  );
});

interface ConversationRowProps {
  message: AssistantMessage;
  colors: ThemeColors;
  contextTone: AssistantConversationRailProps["contextTone"];
  loading?: boolean;
  onQuickReply?: (text: string) => void;
}

function ConversationRow({ message, colors, contextTone, loading, onQuickReply }: ConversationRowProps) {
  const isUser = message.role === "user";
  const tone = nodeColor(message.role, colors, contextTone);
  /**
   * Visual distinction strategy (no chat bubbles, but clearly two different surfaces):
   *
   * - The speaker label is louder for the user turn — solid accent block with white text —
   *   and quiet for the STOCVEST turn (small uppercase tone-tinted label, no chip).
   * - The user message body sits in a clearly tinted accent panel with a strong 3px
   *   ribbon. The STOCVEST message body sits on a neutral surface-muted panel with a
   *   contrasting ribbon in the page tone.
   * - The two surfaces use opposite alignment: user content right-aligns text and sits
   *   in a panel pulled slightly to the right; STOCVEST stays left-aligned and full-width.
   *   The asymmetry plus the contrasting backgrounds make the two roles unmistakable at
   *   a glance, even without color (works for monochrome / colorblind users too).
   */
  const userBg = `${tone}26`; // ~15% opacity accent
  const userBorder = `${tone}66`;
  const assistantBg = colors.surfaceMuted;
  const assistantBorder = `${tone}55`;

  const labelChipStyle: CSSProperties = isUser
    ? {
        display: "inline-block",
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        padding: "2px 8px",
        borderRadius: 999,
        background: tone,
        color: "#0b1322",
        alignSelf: "flex-end"
      }
    : {
        display: "inline-block",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: tone
      };

  const bodyWrapperStyle: CSSProperties = isUser
    ? {
        background: userBg,
        border: `1px solid ${userBorder}`,
        borderLeft: `3px solid ${tone}`,
        padding: `${spacing[2]} ${spacing[3]}`,
        borderRadius: 10,
        marginLeft: spacing[3],
        boxShadow: `0 0 0 1px ${tone}1a inset`,
        textAlign: "right"
      }
    : {
        background: assistantBg,
        border: `1px solid ${colors.border}`,
        borderLeft: `3px solid ${tone}`,
        padding: `${spacing[2]} ${spacing[3]}`,
        borderRadius: 10,
        boxShadow: `0 1px 0 ${assistantBorder} inset`
      };

  return (
    <li
      style={{
        position: "relative",
        paddingLeft: 32,
        display: "grid",
        gap: spacing[1],
        justifyItems: isUser ? "end" : "stretch"
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          top: 4,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: tone,
          boxShadow: `0 0 0 3px ${colors.surface}, 0 0 0 4px ${tone}25`
        }}
      />
      <span style={labelChipStyle}>{speakerLabel(message.role)}</span>
      <div style={bodyWrapperStyle}>
        <MessageBody message={message} colors={colors} align={isUser ? "right" : "left"} />
      </div>
      {/* Price chart mini-card — shown on assistant turns with live market data */}
      {!isUser && message.chart ? (
        <ChartCard chart={message.chart} colors={colors} />
      ) : null}
      {/* Deep-link CTA — shown on assistant turns with a navigate_to field */}
      {!isUser && message.navigate_to ? (
        <NavigateCta href={message.navigate_to} colors={colors} />
      ) : null}
      {/* Watchlist action confirmation card */}
      {!isUser && message.action ? (
        <ActionCard action={message.action} colors={colors} />
      ) : null}
      {/* Ranked discovery card — compact symbol · why · open table */}
      {!isUser && message.discovery && message.discovery.rows.length > 0 ? (
        <DiscoveryCard discovery={message.discovery} colors={colors} />
      ) : null}
      {/* Source-citation chips */}
      {!isUser && message.citations && message.citations.length > 0 ? (
        <CitationChips citations={message.citations} colors={colors} />
      ) : null}
      {/* Clarifying quick-reply chips (e.g. swing vs day desk) */}
      {!isUser && message.clarify && message.clarify.options.length > 0 ? (
        <ClarifyChips
          clarify={message.clarify}
          colors={colors}
          disabled={Boolean(loading)}
          onQuickReply={onQuickReply}
        />
      ) : null}
    </li>
  );
}

function DiscoveryCard({ discovery, colors }: { discovery: AssistantDiscovery; colors: ThemeColors }) {
  const deskLabel = discovery.mode === "swing" ? "Swing" : "Day";
  return (
    <div
      data-testid="assistant-discovery-card"
      data-discovery-mode={discovery.mode}
      style={{
        display: "grid",
        gap: spacing[1],
        padding: `${spacing[2]} ${spacing[3]}`,
        borderRadius: borderRadius.md,
        border: `1px solid ${colors.border}`,
        background: colors.surfaceMuted
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: spacing[2]
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: colors.textMuted
          }}
        >
          {deskLabel} desk · top movers
        </span>
        <Link
          href={discovery.scanner_href}
          data-testid="assistant-discovery-scanner-link"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 10,
            fontWeight: 600,
            color: colors.accent,
            textDecoration: "none"
          }}
        >
          Open Scanner
          <ArrowRight size={11} aria-hidden />
        </Link>
      </div>
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 2 }}>
        {discovery.rows.map((row, i) => (
          <li
            key={row.symbol}
            style={{
              display: "grid",
              gridTemplateColumns: "auto minmax(2.6rem, auto) 1fr",
              alignItems: "baseline",
              gap: spacing[2],
              padding: "3px 0",
              borderTop: i === 0 ? "none" : `1px solid ${colors.border}55`
            }}
          >
            <span style={{ fontSize: 10, color: colors.textMuted, fontVariantNumeric: "tabular-nums" }}>
              {i + 1}
            </span>
            <Link
              href={`/dashboard/signals?symbol=${encodeURIComponent(row.symbol)}&ref=assistant`}
              style={{
                fontWeight: 800,
                fontSize: typography.scale.sm,
                color: colors.text,
                textDecoration: "none",
                letterSpacing: "0.02em"
              }}
            >
              <SymbolName
                symbol={row.symbol}
                layout="stacked"
                symbolStyle={{ fontWeight: "inherit", color: "inherit", letterSpacing: "0.02em" }}
                nameStyle={{ fontWeight: 400, fontSize: 10 }}
                maxNameChars={18}
              />
            </Link>
            <span style={{ fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.45 }}>
              {row.context}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

interface CitationGroup {
  source: string;
  items: AssistantCitation[];
}

/** Group citations by publisher so a source that backs several articles shows as
 *  a single chip ("polygon · 3") instead of repeating the same name N times. */
function groupCitationsBySource(citations: AssistantCitation[]): CitationGroup[] {
  const order: string[] = [];
  const byKey = new Map<string, CitationGroup>();
  for (const c of citations) {
    const source = (c.source || "source").trim();
    const key = source.toLowerCase();
    let group = byKey.get(key);
    if (!group) {
      group = { source, items: [] };
      byKey.set(key, group);
      order.push(key);
    }
    group.items.push(c);
  }
  return order.map((k) => byKey.get(k) as CitationGroup);
}

function CitationChips({ citations, colors }: { citations: AssistantCitation[]; colors: ThemeColors }) {
  const groups = useMemo(() => groupCitationsBySource(citations), [citations]);
  const [openSource, setOpenSource] = useState<string | null>(null);

  return (
    <div data-testid="assistant-citations" style={{ display: "grid", gap: 4 }}>
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: colors.textMuted
        }}
      >
        Sources
      </span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {groups.map((g) => {
          const single = g.items.length === 1;
          const chipStyle: CSSProperties = {
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            maxWidth: "100%",
            fontSize: 10,
            color: colors.textMuted,
            border: `1px solid ${colors.accent}44`,
            background: `${colors.accent}10`,
            borderRadius: 999,
            padding: "2px 9px",
            textDecoration: "none"
          };
          const sourceLabel = (
            <span
              style={{
                fontWeight: 600,
                color: colors.text,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: 180
              }}
            >
              {g.source}
            </span>
          );

          if (single) {
            return (
              <a
                key={g.source}
                href={g.items[0].url}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="assistant-citation-chip"
                title={g.items[0].title}
                style={chipStyle}
              >
                {sourceLabel}
                <ExternalLink size={10} aria-hidden style={{ flexShrink: 0 }} />
              </a>
            );
          }

          const open = openSource === g.source;
          return (
            <button
              key={g.source}
              type="button"
              data-testid="assistant-citation-chip"
              aria-expanded={open}
              title={`${g.items.length} articles from ${g.source}`}
              onClick={() => setOpenSource(open ? null : g.source)}
              style={{ ...chipStyle, cursor: "pointer" }}
            >
              {sourceLabel}
              <span
                aria-hidden
                style={{
                  fontWeight: 700,
                  color: colors.accent,
                  background: `${colors.accent}1f`,
                  borderRadius: 999,
                  padding: "0 5px",
                  lineHeight: "14px"
                }}
              >
                {g.items.length}
              </span>
              <ChevronDown
                size={11}
                aria-hidden
                style={{ flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform 120ms" }}
              />
            </button>
          );
        })}
      </div>

      {openSource
        ? (() => {
            const group = groups.find((g) => g.source === openSource);
            if (!group) return null;
            return (
              <div
                data-testid="assistant-citation-detail"
                style={{
                  display: "grid",
                  gap: 2,
                  marginTop: 2,
                  padding: "6px 8px",
                  borderRadius: 8,
                  border: `1px solid ${colors.border}`,
                  background: `${colors.accent}08`
                }}
              >
                {group.items.map((c, idx) => (
                  <a
                    key={c.url}
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="assistant-citation-detail-link"
                    title={c.title}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 11,
                      lineHeight: 1.35,
                      color: colors.text,
                      textDecoration: "none",
                      padding: "3px 2px"
                    }}
                  >
                    <span style={{ fontWeight: 800, color: colors.accent, flexShrink: 0 }}>{idx + 1}</span>
                    <span
                      style={{
                        flex: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap"
                      }}
                    >
                      {c.title || c.url}
                    </span>
                    <ExternalLink size={11} aria-hidden style={{ flexShrink: 0, color: colors.textMuted }} />
                  </a>
                ))}
              </div>
            );
          })()
        : null}
    </div>
  );
}

function ClarifyChips({
  clarify,
  colors,
  disabled,
  onQuickReply
}: {
  clarify: AssistantClarify;
  colors: ThemeColors;
  disabled: boolean;
  onQuickReply?: (text: string) => void;
}) {
  if (!onQuickReply) return null;
  return (
    <div data-testid="assistant-clarify" style={{ display: "grid", gap: 6 }}>
      {clarify.prompt ? (
        <span style={{ fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.45 }}>
          {clarify.prompt}
        </span>
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {clarify.options.map((opt) => (
          <button
            key={opt.send}
            type="button"
            data-testid="assistant-clarify-option"
            disabled={disabled}
            onClick={() => onQuickReply(opt.send)}
            style={{
              minHeight: 30,
              padding: "4px 12px",
              fontSize: typography.scale.xs,
              fontWeight: 600,
              cursor: disabled ? "default" : "pointer",
              opacity: disabled ? 0.5 : 1,
              color: colors.accent,
              border: `1px solid ${colors.accent}66`,
              background: `${colors.accent}14`,
              borderRadius: 999
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function NavigateCta({ href, colors }: { href: string; colors: ThemeColors }) {
  return (
    <Link
      href={href}
      data-testid="assistant-navigate-cta"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: `${spacing[2]} ${spacing[3]}`,
        borderRadius: borderRadius.md,
        border: `1px solid ${colors.accent}55`,
        background: `${colors.accent}12`,
        color: colors.accent,
        fontSize: typography.scale.xs,
        fontWeight: 600,
        textDecoration: "none",
        cursor: "pointer",
        transition: "background 120ms ease"
      }}
    >
      Open full analysis
      <ArrowRight size={12} aria-hidden />
    </Link>
  );
}

function ActionCard({ action, colors }: { action: AssistantAction; colors: ThemeColors }) {
  const isSuccess = action.success;
  const iconColor = isSuccess ? colors.bullish : colors.bearish ?? colors.textMuted;
  return (
    <div
      data-testid="assistant-action-card"
      data-action-type={action.type}
      style={{
        display: "flex",
        alignItems: "center",
        gap: spacing[2],
        padding: `${spacing[2]} ${spacing[3]}`,
        borderRadius: borderRadius.md,
        border: `1px solid ${iconColor}44`,
        background: `${iconColor}10`,
        fontSize: typography.scale.xs,
        color: colors.textMuted
      }}
    >
      {isSuccess
        ? <CheckCircle size={13} style={{ color: iconColor, flexShrink: 0 }} aria-hidden />
        : <XCircle size={13} style={{ color: iconColor, flexShrink: 0 }} aria-hidden />
      }
      <span>{action.message}</span>
    </div>
  );
}

const CHART_H = 40; // svg viewBox height units

function levelColor(kind: AssistantChartLevel["kind"], colors: ThemeColors): string {
  switch (kind) {
    case "support":
      return colors.bullish;
    case "resistance":
      return colors.bearish ?? colors.textMuted;
    case "target":
      return colors.caution ?? colors.accent;
    case "vwap":
      return colors.accent;
    case "sma50":
      return "#8b5cf6"; // violet — distinct from VWAP/accent
    case "prev_close":
    default:
      return colors.textMuted;
  }
}

function ChartCard({ chart, colors }: { chart: AssistantChart; colors: ThemeColors }) {
  const [expanded, setExpanded] = useState(false);
  const up = chart.direction === "up";
  const down = chart.direction === "down";
  const lineColor = up ? colors.bullish : down ? (colors.bearish ?? colors.textMuted) : colors.textMuted;

  const changeLabel =
    typeof chart.change_pct === "number"
      ? `${chart.change_pct >= 0 ? "+" : ""}${chart.change_pct.toFixed(2)}%`
      : null;
  const lastLabel = typeof chart.last === "number" ? formatPrice(chart.last) : null;
  const asOfLabel = formatAsOf(chart.as_of);
  const levels = Array.isArray(chart.levels) ? chart.levels.filter((l) => Number.isFinite(l.value)) : [];

  const geo = useMemo(() => buildChartGeometry(chart.points, levels), [chart.points, levels]);

  return (
    <div
      data-testid="assistant-chart-card"
      data-chart-symbol={chart.symbol}
      data-chart-direction={chart.direction}
      style={{
        display: "grid",
        gap: spacing[1],
        padding: `${spacing[2]} ${spacing[3]}`,
        borderRadius: borderRadius.md,
        border: `1px solid ${lineColor}44`,
        background: `${lineColor}10`
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: spacing[2]
        }}
      >
        <SymbolName
          symbol={chart.symbol}
          symbolStyle={{ fontWeight: 800, fontSize: typography.scale.sm, color: colors.text, letterSpacing: "0.02em" }}
          nameStyle={{ fontWeight: 400 }}
          maxNameChars={22}
        />
        <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}>
          {lastLabel ? (
            <span style={{ fontWeight: 700, fontSize: typography.scale.sm, color: colors.text }}>{lastLabel}</span>
          ) : null}
          {changeLabel ? (
            <span style={{ fontWeight: 700, fontSize: typography.scale.xs, color: lineColor }}>{changeLabel}</span>
          ) : null}
        </span>
      </div>

      {geo ? (
        <svg
          role="img"
          aria-label={`${chart.symbol} intraday price trend, ${chart.direction}`}
          viewBox={`0 0 100 ${CHART_H}`}
          preserveAspectRatio="none"
          style={{ width: "100%", height: 52, display: "block", overflow: "visible" }}
        >
          {/* Reference level lines that fall within the visible range */}
          {geo.drawnLevels.map((l) => (
            <line
              key={`${l.kind}-${l.value}`}
              x1={0}
              x2={100}
              y1={l.y}
              y2={l.y}
              stroke={levelColor(l.kind, colors)}
              strokeWidth={0.75}
              strokeDasharray="2 2"
              vectorEffect="non-scaling-stroke"
              opacity={0.7}
            />
          ))}
          <path d={`${geo.path} L 100,${CHART_H} L 0,${CHART_H} Z`} fill={`${lineColor}1f`} stroke="none" />
          <path
            d={geo.path}
            fill="none"
            stroke={lineColor}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      ) : null}

      {/* Level chips — always shown when levels exist, even if off-chart */}
      {levels.length > 0 ? (
        <div data-testid="assistant-chart-levels" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 2 }}>
          {levels.map((l) => (
            <span
              key={`${l.kind}-${l.value}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 10,
                color: colors.textMuted,
                border: `1px solid ${levelColor(l.kind, colors)}55`,
                background: `${levelColor(l.kind, colors)}12`,
                borderRadius: 999,
                padding: "1px 7px"
              }}
            >
              <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", background: levelColor(l.kind, colors) }} />
              <span style={{ fontWeight: 600, color: colors.text }}>{l.label}</span>
              <span>{formatPrice(l.value)}</span>
              {typeof l.distance_pct === "number" ? (
                <span style={{ color: levelColor(l.kind, colors) }}>
                  {l.distance_pct >= 0 ? "+" : ""}
                  {l.distance_pct.toFixed(1)}%
                </span>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing[2] }}>
        <span style={{ fontSize: 10, color: colors.textMuted, letterSpacing: "0.04em" }}>
          {chart.kind === "intraday" ? `Intraday · ${chart.interval ?? "5m"}` : "Latest quote"}
          {asOfLabel ? ` · ${asOfLabel}` : ""}
        </span>
        {chart.symbol ? (
          <button
            type="button"
            data-testid="assistant-chart-expand"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              minHeight: 28,
              padding: "2px 8px",
              fontSize: 10,
              fontWeight: 600,
              cursor: "pointer",
              color: colors.accent,
              border: `1px solid ${colors.accent}55`,
              background: `${colors.accent}12`,
              borderRadius: 999
            }}
          >
            <LineChart size={12} aria-hidden />
            {expanded ? "Hide full chart" : "Expand chart"}
          </button>
        ) : null}
      </div>

      {expanded && chart.symbol ? (
        <div style={{ marginTop: spacing[1] }}>
          <FullPriceChart symbol={chart.symbol} colors={colors} levels={levels} />
          <span style={{ fontSize: 10, color: colors.textMuted, letterSpacing: "0.04em" }}>
            Daily candles · 50-day average · reference levels
          </span>
        </div>
      ) : null}
    </div>
  );
}

interface ChartGeometry {
  path: string;
  drawnLevels: Array<AssistantChartLevel & { y: number }>;
}

/**
 * Build the sparkline path plus the y-coordinates of any reference levels that
 * fall close enough to the price band to be drawn. The y-domain auto-scales to
 * the intraday closes, then expands to include nearby levels (within ~1.2× the
 * price range) so support/resistance/VWAP render on-chart without flattening the
 * line for far-away levels (e.g. a distant analyst target stays chips-only).
 */
function buildChartGeometry(
  points: AssistantChart["points"],
  levels: AssistantChartLevel[]
): ChartGeometry | null {
  if (!Array.isArray(points) || points.length < 2) return null;
  const closes = points.map((p) => p.c).filter((c) => typeof c === "number" && Number.isFinite(c));
  if (closes.length < 2) return null;

  let domMin = Math.min(...closes);
  let domMax = Math.max(...closes);
  const priceRange = domMax - domMin || Math.max(Math.abs(domMax) * 0.01, 1);
  const proximity = priceRange * 1.2;

  const nearby = levels.filter(
    (l) => Number.isFinite(l.value) && l.value >= domMin - proximity && l.value <= domMax + proximity
  );
  for (const l of nearby) {
    domMin = Math.min(domMin, l.value);
    domMax = Math.max(domMax, l.value);
  }
  const range = domMax - domMin || 1;
  const yOf = (v: number) => CHART_H - ((v - domMin) / range) * CHART_H;

  const n = closes.length;
  const path = closes
    .map((c, i) => `${i === 0 ? "M" : "L"} ${((i / (n - 1)) * 100).toFixed(2)},${yOf(c).toFixed(2)}`)
    .join(" ");

  const drawnLevels = nearby.map((l) => ({ ...l, y: Number(yOf(l.value).toFixed(2)) }));
  return { path, drawnLevels };
}

function formatPrice(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatAsOf(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  } catch {
    return null;
  }
}

function MessageBody({
  message,
  colors,
  align = "left"
}: {
  message: AssistantMessage;
  colors: ThemeColors;
  align?: "left" | "right";
}) {
  if (message.role === "assistant" && message.pending) {
    return (
      <span
        aria-label="STOCVEST Assistant is thinking"
        style={{
          color: colors.textMuted,
          fontSize: typography.scale.sm,
          display: "inline-flex",
          alignItems: "center",
          gap: 2
        }}
      >
        <span className="stocvest-assistant-thinking-dot" />
        <span className="stocvest-assistant-thinking-dot" />
        <span className="stocvest-assistant-thinking-dot" />
      </span>
    );
  }
  if (message.role === "assistant" && message.fresh) {
    return <FreshAssistantText text={message.content} colors={colors} />;
  }
  const textColor = align === "right" ? "#bae6fd" : "#e2e8f0";
  return (
    <p
      style={{
        margin: 0,
        color: textColor,
        fontSize: typography.scale.sm,
        lineHeight: 1.6,
        whiteSpace: "pre-wrap",
        textAlign: align,
        fontWeight: align === "right" ? 500 : 400
      }}
    >
      {message.content}
    </p>
  );
}

/**
 * Word-fade reveal — every whitespace-separated token enters with a small per-word stagger.
 * The animation length is capped (we never apply a delay larger than ~3.6s) so even long
 * answers finish revealing quickly enough to feel responsive.
 */
function FreshAssistantText({ text, colors }: { text: string; colors: ThemeColors }) {
  const words = useMemo(() => splitForReveal(text), [text]);
  return (
    <p
      style={{
        margin: 0,
        color: "#e2e8f0",
        fontSize: typography.scale.sm,
        lineHeight: 1.6,
        whiteSpace: "pre-wrap"
      }}
    >
      {words.map((w, i) => (
        <span
          key={`${i}-${w.token}`}
          className="stocvest-assistant-word"
          style={{ animationDelay: `${Math.min(i * 38, 3600)}ms` }}
        >
          {w.token}
        </span>
      ))}
    </p>
  );
}

interface RevealToken {
  token: string;
}

/** Split keeping whitespace attached so wrapping behaves naturally. */
function splitForReveal(text: string): RevealToken[] {
  if (!text) return [];
  const parts = text.match(/\S+\s*/g) ?? [text];
  return parts.map((token) => ({ token }));
}

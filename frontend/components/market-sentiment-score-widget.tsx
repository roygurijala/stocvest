"use client";

import type { MarketOverview, MarketStatusPayload, SnapshotPayload } from "@/lib/api/market";
import type { ThemeColors } from "@/lib/design-system";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import { getEtClock } from "@/lib/market-hours-et";
import { DecisionMetric } from "@/components/decision-metric";
import { InfoTip } from "@/components/info-tip";
import {
  IWM_CARD_TIP,
  INDEX_LAST_PRICE_DECISION_TIP,
  INDEX_SESSION_CHANGE_DECISION_TIP,
  INDEX_SUBSCORE_TIP,
  MARKET_SENTIMENT_SCORE_TIP,
  QQQ_CARD_TIP,
  SENTIMENT_FROM_OPEN_TIP,
  SENTIMENT_SCORE_NUMBER_TIP,
  SPY_CARD_TIP
} from "@/lib/ui-tooltips";

const MONO = `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace`;

const STAT_SYMBOLS = ["SPY", "QQQ", "IWM"] as const;

const INDEX_META: Record<(typeof STAT_SYMBOLS)[number], { cap: string }> = {
  SPY: { cap: "Large cap" },
  QQQ: { cap: "Tech / growth" },
  IWM: { cap: "Small cap" }
};

/** #rrggbb → rgba(r,g,b,a) for theme-aware borders/fills */
function withAlpha(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

export type IndexSentimentStyle = {
  text: string;
  border: string;
  background: string;
  label: string;
  dot: string;
};

function sentimentTierLabel(score: number): "Bullish" | "Bearish" | "Neutral" {
  if (score >= 65) return "Bullish";
  if (score <= 35) return "Bearish";
  return "Neutral";
}

/** Green / amber / red bands for index sub-scores and headline gauge (uses theme tokens). */
export function getSentimentStyle(score: number, colors: ThemeColors): IndexSentimentStyle {
  const label = sentimentTierLabel(score);
  if (label === "Bullish") {
    return {
      text: colors.bullish,
      border: withAlpha(colors.bullish, 0.25),
      background: withAlpha(colors.bullish, 0.06),
      label,
      dot: colors.bullish
    };
  }
  if (label === "Bearish") {
    return {
      text: colors.bearish,
      border: withAlpha(colors.bearish, 0.25),
      background: withAlpha(colors.bearish, 0.06),
      label,
      dot: colors.bearish
    };
  }
  return {
    text: colors.caution,
    border: withAlpha(colors.caution, 0.25),
    background: withAlpha(colors.caution, 0.08),
    label,
    dot: colors.caution
  };
}

export function getChangeColor(pct: number, colors: ThemeColors): string {
  if (pct > 0.1) return colors.bullish;
  if (pct < -0.1) return colors.bearish;
  return colors.textMuted;
}

function computeSnapshotChange(snapshot: SnapshotPayload): { percent: number } {
  const last = snapshot.last_trade_price ?? null;
  const prev = snapshot.prev_close ?? null;
  if (typeof last !== "number" || typeof prev !== "number" || prev === 0) {
    return { percent: 0 };
  }
  return { percent: ((last - prev) / prev) * 100 };
}

function formatLastPrice(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

function scoreFromChangePercent(pct: number): number {
  return Math.max(0, Math.min(100, Math.round(50 + pct * 10)));
}

function scoreFromOpen(snapshot: SnapshotPayload): number | null {
  const open = snapshot.day_open ?? null;
  const prev = snapshot.prev_close ?? null;
  if (typeof open !== "number" || typeof prev !== "number" || prev === 0) return null;
  const pct = ((open - prev) / prev) * 100;
  return scoreFromChangePercent(pct);
}

function marketSessionBadge(status: MarketStatusPayload | undefined): { label: string; tone: "open" | "pre" | "after" } {
  const m = (status?.market || "").toLowerCase();
  if (m === "open") return { label: "Market Open", tone: "open" };
  const { hour, minute, weekday } = getEtClock(new Date());
  if (weekday !== "Sat" && weekday !== "Sun") {
    const t = hour * 60 + minute;
    if (t >= 4 * 60 && t < 9 * 60 + 30) return { label: "Pre-Market", tone: "pre" };
  }
  if (m.includes("extended") || m.includes("early")) return { label: "Pre-Market", tone: "pre" };
  return { label: "After Hours", tone: "after" };
}

function buildInterpretation(spy: number, qqq: number, iwm: number): { line1: string; line2: string } {
  if (qqq >= spy + 10 && spy >= iwm + 10) {
    return {
      line1: "Tech leading, small caps lagging.",
      line2: "Narrow rally — monitor breadth."
    };
  }
  if (spy >= 60 && qqq >= 60 && iwm >= 60) {
    return {
      line1: "Broad market strength confirmed.",
      line2: "Risk-on conditions across all caps."
    };
  }
  if (spy < 45 && qqq < 45 && iwm < 45) {
    return {
      line1: "Broad weakness across all indices.",
      line2: "Risk-off — reduce exposure."
    };
  }
  if (iwm >= qqq + 10) {
    return {
      line1: "Small caps leading — risk appetite high.",
      line2: "Favorable for momentum setups."
    };
  }
  return {
    line1: "Mixed signals across indices.",
    line2: "Confirm direction before trading."
  };
}

function favorToday(score: number): { text: string; color: string } {
  if (score > 65) return { text: "Large cap longs", color: "#00e87a" };
  if (score >= 50) return { text: "High conviction only", color: "#f5c542" };
  return { text: "Reduced size", color: "#ff8c42" };
}

function narrativeBlurb(spy: number, qqq: number, iwm: number): string {
  const avg = (spy + qqq + iwm) / 3;
  if (avg >= 58) return "Tape skews constructive.\nLeaders are pricing better outcomes.";
  if (avg <= 42) return "Tape skews defensive.\nWait for clearer breadth.";
  return "Tape is balanced.\nSize to your plan and levels.";
}

function sparklinePath(closes: number[]): string {
  if (closes.length < 2) return "";
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const w = 70;
  const h = 18;
  const pts = closes.map((c, i) => {
    const x = (i / (closes.length - 1)) * w;
    const y = h - ((c - min) / span) * (h - 2) - 1;
    return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  return pts.join(" ");
}

function sparklineTrend(score: number, closes: number[]): "up" | "down" | "flat" {
  if (closes.length < 2) return score >= 55 ? "up" : score <= 45 ? "down" : "flat";
  const a = closes[0] ?? 0;
  const b = closes[closes.length - 1] ?? 0;
  const d = b - a;
  if (Math.abs(d) < 1e-6) return "flat";
  return d > 0 ? "up" : "down";
}

export type MarketSentimentModel = {
  sentiment_score: number;
  sentiment_label: string;
  change_from_open: number | null;
  components: Array<{ symbol: string; score: number; change_pct: number; last_price: number | null }>;
  interpretation: { line1: string; line2: string };
  favor_today: { text: string; color: string };
  market_status: string;
  session_badge: { label: string; tone: "open" | "pre" | "after" };
};

export function buildMarketSentimentModel(overview: MarketOverview): MarketSentimentModel | null {
  const statList = STAT_SYMBOLS as readonly string[];
  const snaps = overview.snapshots.filter((s) => statList.includes(s.symbol.trim().toUpperCase()));
  if (snaps.length === 0) return null;

  const bySym = new Map(snaps.map((s) => [s.symbol.trim().toUpperCase(), s] as const));
  const components: Array<{ symbol: string; score: number; change_pct: number; last_price: number | null }> = [];
  for (const sym of STAT_SYMBOLS) {
    const s = bySym.get(sym);
    if (!s) continue;
    const { percent } = computeSnapshotChange(s);
    const lp = s.last_trade_price;
    const last_price = typeof lp === "number" && Number.isFinite(lp) ? lp : null;
    components.push({ symbol: sym, score: scoreFromChangePercent(percent), change_pct: percent, last_price });
  }
  if (components.length === 0) return null;

  const avgPct = components.reduce((a, c) => a + c.change_pct, 0) / components.length;
  const sentiment_score = Math.max(0, Math.min(100, Math.round(50 + avgPct * 10)));
  const sentiment_label = sentimentTierLabel(sentiment_score);

  const deltas: number[] = [];
  for (const c of components) {
    const s = bySym.get(c.symbol);
    if (!s) continue;
    const so = scoreFromOpen(s);
    if (so === null) continue;
    deltas.push(c.score - so);
  }
  const change_from_open = deltas.length === components.length ? Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length) : null;

  const spy = components.find((c) => c.symbol === "SPY")?.score ?? 50;
  const qqq = components.find((c) => c.symbol === "QQQ")?.score ?? 50;
  const iwm = components.find((c) => c.symbol === "IWM")?.score ?? 50;
  const interpretation = buildInterpretation(spy, qqq, iwm);
  const favor_today = favorToday(sentiment_score);
  const session_badge = marketSessionBadge(overview.status);
  const market_status = session_badge.label;

  return {
    sentiment_score,
    sentiment_label,
    change_from_open,
    components,
    interpretation,
    favor_today,
    market_status,
    session_badge
  };
}

function SkeletonBlock() {
  return (
    <div
      style={{
        height: 120,
        borderRadius: 12,
        background: "linear-gradient(90deg, rgba(148,163,184,0.08), rgba(148,163,184,0.16), rgba(148,163,184,0.08))",
        backgroundSize: "200% 100%",
        animation: "stocvest-ms-skel 1.2s ease-in-out infinite"
      }}
    />
  );
}

const INDEX_CARD_TIP: Record<(typeof STAT_SYMBOLS)[number], string> = {
  SPY: SPY_CARD_TIP,
  QQQ: QQQ_CARD_TIP,
  IWM: IWM_CARD_TIP
};

type Props = {
  marketOverview: MarketOverview;
  /** When true, sits inside `DashboardCard`: lighter chrome and no duplicate info icon on the first row. */
  embedded?: boolean;
};

export function MarketSentimentScoreWidget({ marketOverview, embedded = false }: Props) {
  const { colors } = useTheme();
  const model = buildMarketSentimentModel(marketOverview);
  const sparkBy = marketOverview.sparklinesBySymbol ?? {};

  if (marketOverview.snapshots.length === 0 && !marketOverview.error) {
    return (
      <div style={{ fontFamily: MONO }}>
        <style>{`@keyframes stocvest-ms-skel { 0% { background-position: 0% 0; } 100% { background-position: 200% 0; } }`}</style>
        <SkeletonBlock />
      </div>
    );
  }

  if (!model) {
    return (
      <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.sm, fontFamily: MONO }}>
        {marketOverview.error
          ? marketOverview.error.includes("timed out")
            ? "Market data timed out — try refreshing the page."
            : marketOverview.error
          : "Not enough index data for sentiment."}
      </p>
    );
  }

  const mainStyle = getSentimentStyle(model.sentiment_score, colors);
  const badgeBg =
    model.session_badge.tone === "open"
      ? "rgba(34,197,94,0.2)"
      : model.session_badge.tone === "pre"
        ? "rgba(245,158,11,0.22)"
        : "rgba(100,116,139,0.25)";
  const badgeFg =
    model.session_badge.tone === "open" ? colors.bullish : model.session_badge.tone === "pre" ? colors.caution : colors.textMuted;

  const fromOpen = model.change_from_open;
  const fromOpenColor =
    fromOpen == null ? colors.textMuted : fromOpen < 0 ? colors.bearish : fromOpen > 0 ? colors.bullish : colors.textMuted;

  const blurb = narrativeBlurb(
    model.components.find((c) => c.symbol === "SPY")?.score ?? 50,
    model.components.find((c) => c.symbol === "QQQ")?.score ?? 50,
    model.components.find((c) => c.symbol === "IWM")?.score ?? 50
  );
  const blurbLines = blurb.split("\n");

  return (
    <div
      className={embedded ? undefined : surfaceGlowClassName}
      style={{
        background: embedded ? "transparent" : "var(--color-background-secondary)",
        border: embedded ? "none" : "0.5px solid var(--color-border-tertiary)",
        borderRadius: 12,
        padding: embedded ? 0 : "20px 24px",
        fontFamily: MONO,
        display: "grid",
        gap: 20,
        boxShadow: embedded ? "none" : undefined
      }}
    >
      {/* Section 1 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: spacing[2] }}>
        <div style={{ display: "flex", alignItems: "center", gap: spacing[2], minWidth: 0 }}>
          <span
            style={{
              fontSize: 9,
              letterSpacing: 3,
              textTransform: "uppercase",
              color: "var(--color-text-tertiary)"
            }}
          >
            Market Sentiment
          </span>
          {embedded ? null : <InfoTip text={MARKET_SENTIMENT_SCORE_TIP} label="About market sentiment score" maxWidth={300} />}
        </div>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            padding: "4px 10px",
            borderRadius: 6,
            background: badgeBg,
            color: badgeFg,
            flexShrink: 0
          }}
        >
          {model.session_badge.label}
        </span>
      </div>

      {/* Section 2 */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          alignItems: "flex-start"
        }}
      >
        <div style={{ minWidth: 100, flex: "0 0 auto" }}>
          <div
            style={{
              fontSize: "3.5rem",
              fontWeight: 800,
              letterSpacing: -2,
              lineHeight: 1,
              color: mainStyle.text
            }}
          >
            <DecisionMetric explanation={SENTIMENT_SCORE_NUMBER_TIP} label="How the headline sentiment score is used" maxWidth={300}>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{model.sentiment_score}</span>
            </DecisionMetric>
          </div>
          <span
            style={{
              color: mainStyle.text,
              fontSize: "0.9rem",
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              marginTop: 4,
              display: "block"
            }}
          >
            {mainStyle.label}
          </span>
          {fromOpen != null ? (
            <span
              style={{
                color: fromOpenColor,
                fontSize: "0.8rem",
                fontWeight: 600,
                marginTop: 4,
                display: "block"
              }}
            >
              <DecisionMetric explanation={SENTIMENT_FROM_OPEN_TIP} label="How change from open is used" maxWidth={300}>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>
                  {fromOpen > 0 ? "+" : ""}
                  {fromOpen} from open
                </span>
              </DecisionMetric>
            </span>
          ) : null}
        </div>

        <div style={{ minWidth: 140, flex: "1 1 200px", paddingTop: 8 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, fontSize: 10, color: "var(--color-text-muted)" }}>
            <span>Fear</span>
            <span>Greed</span>
          </div>
          <div style={{ position: "relative", height: 16, marginBottom: 4 }}>
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: 6,
                height: 4,
                borderRadius: 2,
                background: "linear-gradient(90deg, #ff3d5a 0%, #ff8c42 22%, #f5c542 45%, #00e87a 72%, #00b4d8 100%)"
              }}
            />
            <div
              style={{
                position: "absolute",
                left: `${model.sentiment_score}%`,
                top: 0,
                transform: "translateX(-50%)",
                width: 3,
                height: 16,
                background: "#fff",
                borderRadius: 1,
                boxShadow: "0 0 8px rgba(255,255,255,0.5)"
              }}
            />
            <div
              style={{
                position: "absolute",
                left: `${model.sentiment_score}%`,
                top: 17,
                transform: "translateX(-50%)",
                width: 0,
                height: 0,
                borderLeft: "5px solid transparent",
                borderRight: "5px solid transparent",
                borderTop: "6px solid #fff",
                filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.3))"
              }}
            />
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(5, 1fr)",
              gap: 2,
              fontSize: 8,
              color: "var(--color-text-tertiary)",
              textAlign: "center",
              marginTop: 4
            }}
          >
            <span>0–25</span>
            <span>25–45</span>
            <span>45–60</span>
            <span>60–80</span>
            <span>80–100</span>
          </div>
        </div>

        <div
          style={{
            fontSize: 11,
            color: "var(--color-text-muted)",
            textAlign: "right",
            maxWidth: 160,
            marginLeft: "auto",
            lineHeight: 1.45,
            flex: "1 1 140px"
          }}
        >
          {blurbLines.map((line, i) => (
            <span key={i} style={{ display: "block", marginTop: i ? 4 : 0 }}>
              {line}
            </span>
          ))}
        </div>
      </div>

      <div style={{ height: 0.5, background: "var(--color-border-tertiary)" }} />

      {/* Section 3 — index cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 10
        }}
      >
        {model.components.map((c) => {
          const sym = c.symbol as (typeof STAT_SYMBOLS)[number];
          const cardTip = INDEX_CARD_TIP[sym];
          const meta = INDEX_META[sym];
          const style = getSentimentStyle(c.score, colors);
          const path = sparklinePath(sparkBy[c.symbol] ?? []);
          const trend = sparklineTrend(c.score, sparkBy[c.symbol] ?? []);
          const stroke =
            trend === "up" ? "rgba(0,232,122,0.9)" : trend === "down" ? "rgba(255,61,90,0.9)" : "rgba(148,163,184,0.8)";
          const pctStr = `${c.change_pct >= 0 ? "+" : ""}${c.change_pct.toFixed(2)}%`;
          const lp = c.last_price;
          const priceLabel = typeof lp === "number" && Number.isFinite(lp) ? `$${lp.toFixed(2)}` : "—";
          return (
            <div
              key={c.symbol}
              style={{
                position: "relative",
                border: "0.5px solid var(--color-border-tertiary)",
                borderRadius: borderRadius.lg,
                padding: 12,
                borderLeft: `3px solid ${style.text}`,
                backgroundColor: style.background,
                overflow: "hidden",
                minWidth: 0
              }}
            >
              {path ? (
                <svg
                  width={76}
                  height={24}
                  viewBox="0 0 70 20"
                  style={{ position: "absolute", right: 4, bottom: 2, opacity: 0.12, pointerEvents: "none" }}
                  aria-hidden
                >
                  <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                </svg>
              ) : null}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                <span className="font-semibold" style={{ fontSize: 13, color: colors.text }}>
                  {c.symbol}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span
                    style={{
                      color: style.text,
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      gap: 4
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        backgroundColor: style.dot,
                        display: "inline-block",
                        flexShrink: 0
                      }}
                    />
                    <DecisionMetric explanation={INDEX_SUBSCORE_TIP} label="How index sub-score is used" maxWidth={280}>
                      <span>{style.label}</span>
                    </DecisionMetric>
                  </span>
                  <InfoTip text={cardTip} label={`About ${c.symbol}`} maxWidth={280} />
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  marginTop: 6,
                  flexWrap: "wrap"
                }}
              >
                <span
                  style={{
                    color: colors.text,
                    fontSize: "1.1rem",
                    fontWeight: 700,
                    fontVariantNumeric: "tabular-nums"
                  }}
                >
                  <DecisionMetric explanation={INDEX_LAST_PRICE_DECISION_TIP} label="How last price is used" maxWidth={280}>
                    <span>{priceLabel}</span>
                  </DecisionMetric>
                </span>
                <span
                  style={{
                    color: getChangeColor(c.change_pct, colors),
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    fontVariantNumeric: "tabular-nums"
                  }}
                >
                  <DecisionMetric explanation={INDEX_SESSION_CHANGE_DECISION_TIP} label="How session change is used" maxWidth={280}>
                    <span>{pctStr}</span>
                  </DecisionMetric>
                </span>
              </div>
              <p
                style={{
                  color: colors.textMuted,
                  fontSize: "0.75rem",
                  marginTop: 4,
                  marginBottom: 0
                }}
              >
                {meta.cap}
              </p>
              <div
                style={{
                  height: 2,
                  background: style.text,
                  opacity: 0.5,
                  borderRadius: 1,
                  marginTop: 10
                }}
              />
            </div>
          );
        })}
      </div>

      {/* Section 4 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 200px", minWidth: 0, fontSize: 11, lineHeight: 1.45 }}>
          <p style={{ margin: 0, fontWeight: 800, color: mainStyle.text }}>{model.interpretation.line1}</p>
          <p style={{ margin: "6px 0 0", fontWeight: 400, color: "var(--color-text-muted)" }}>{model.interpretation.line2}</p>
        </div>
        <div style={{ flexShrink: 0, textAlign: "right" }}>
          <div style={{ fontSize: 8, letterSpacing: 2, color: "var(--color-text-tertiary)", marginBottom: 4 }}>FAVOR TODAY</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: model.favor_today.color }}>{model.favor_today.text}</div>
        </div>
      </div>
    </div>
  );
}

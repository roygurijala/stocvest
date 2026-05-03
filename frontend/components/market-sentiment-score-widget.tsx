"use client";

import type { MarketOverview, MarketStatusPayload, SnapshotPayload } from "@/lib/api/market";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import { getEtClock } from "@/lib/market-hours-et";
import { InfoTip } from "@/components/info-tip";
import { MARKET_SENTIMENT_SCORE_TIP } from "@/lib/ui-tooltips";

const MONO = `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace`;

const STAT_SYMBOLS = ["SPY", "QQQ", "IWM"] as const;

const INDEX_META: Record<(typeof STAT_SYMBOLS)[number], { cap: string }> = {
  SPY: { cap: "Large cap" },
  QQQ: { cap: "Tech / growth" },
  IWM: { cap: "Small cap" }
};

function computeSnapshotChange(snapshot: SnapshotPayload): { percent: number } {
  const last = snapshot.last_trade_price ?? null;
  const prev = snapshot.prev_close ?? null;
  if (typeof last !== "number" || typeof prev !== "number" || prev === 0) {
    return { percent: 0 };
  }
  return { percent: ((last - prev) / prev) * 100 };
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

function mainReading(score: number): { label: string; color: string } {
  if (score <= 25) return { label: "Extreme Fear", color: "#ff3d5a" };
  if (score <= 45) return { label: "Fear", color: "#ff8c42" };
  if (score <= 60) return { label: "Neutral", color: "#f5c542" };
  if (score <= 80) return { label: "Greed", color: "#00e87a" };
  return { label: "Extreme Greed", color: "#00b4d8" };
}

function componentReading(score: number): "bullish" | "neutral" | "weak" {
  if (score >= 60) return "bullish";
  if (score >= 45) return "neutral";
  return "weak";
}

function borderAccentForScore(score: number): string {
  if (score >= 60) return "rgba(0,232,122,0.4)";
  if (score >= 45) return "rgba(245,197,66,0.4)";
  return "rgba(255,61,90,0.4)";
}

function barFillForScore(score: number): string {
  if (score >= 60) return "#00e87a";
  if (score >= 45) return "#f5c542";
  return "#ff3d5a";
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
  components: Array<{ symbol: string; score: number; change_pct: number }>;
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
  const components: Array<{ symbol: string; score: number; change_pct: number }> = [];
  for (const sym of STAT_SYMBOLS) {
    const s = bySym.get(sym);
    if (!s) continue;
    const { percent } = computeSnapshotChange(s);
    components.push({ symbol: sym, score: scoreFromChangePercent(percent), change_pct: percent });
  }
  if (components.length === 0) return null;

  const avgPct = components.reduce((a, c) => a + c.change_pct, 0) / components.length;
  const sentiment_score = Math.max(0, Math.min(100, Math.round(50 + avgPct * 10)));
  const sentiment_label = mainReading(sentiment_score).label;

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

type Props = {
  marketOverview: MarketOverview;
};

export function MarketSentimentScoreWidget({ marketOverview }: Props) {
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
        {marketOverview.error ? "Unable to load market snapshots." : "Not enough index data for sentiment."}
      </p>
    );
  }

  const reading = mainReading(model.sentiment_score);
  const badgeBg =
    model.session_badge.tone === "open"
      ? "rgba(34,197,94,0.2)"
      : model.session_badge.tone === "pre"
        ? "rgba(245,158,11,0.22)"
        : "rgba(100,116,139,0.25)";
  const badgeFg =
    model.session_badge.tone === "open" ? colors.bullish : model.session_badge.tone === "pre" ? colors.caution : colors.textMuted;

  const changeColor =
    model.change_from_open != null ? (model.change_from_open > 0 ? "#00e87a" : model.change_from_open < 0 ? "#ff3d5a" : colors.textMuted) : colors.textMuted;

  const blurb = narrativeBlurb(
    model.components.find((c) => c.symbol === "SPY")?.score ?? 50,
    model.components.find((c) => c.symbol === "QQQ")?.score ?? 50,
    model.components.find((c) => c.symbol === "IWM")?.score ?? 50
  );
  const blurbLines = blurb.split("\n");

  return (
    <div
      className={surfaceGlowClassName}
      style={{
        background: "var(--color-background-secondary)",
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: 12,
        padding: "20px 24px",
        fontFamily: MONO,
        display: "grid",
        gap: 20
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
          <InfoTip text={MARKET_SENTIMENT_SCORE_TIP} label="About market sentiment score" />
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
              fontSize: 56,
              fontWeight: 600,
              letterSpacing: -2,
              lineHeight: 1,
              color: colors.text
            }}
          >
            {model.sentiment_score}
          </div>
          <div style={{ marginTop: 6, fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: reading.color, fontWeight: 600 }}>
            {reading.label}
          </div>
          {model.change_from_open != null ? (
            <div style={{ marginTop: 8, fontSize: 10, color: "var(--color-text-muted)" }}>
              <span style={{ color: changeColor, fontWeight: 600 }}>
                {model.change_from_open > 0 ? "+" : ""}
                {model.change_from_open} from open
              </span>
            </div>
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

      {/* Section 3 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        {model.components.map((c) => {
          const meta = INDEX_META[c.symbol as keyof typeof INDEX_META];
          const word = componentReading(c.score);
          const path = sparklinePath(sparkBy[c.symbol] ?? []);
          const trend = sparklineTrend(c.score, sparkBy[c.symbol] ?? []);
          const stroke =
            trend === "up" ? "rgba(0,232,122,0.9)" : trend === "down" ? "rgba(255,61,90,0.9)" : "rgba(148,163,184,0.8)";
          const pctStr = `${c.change_pct >= 0 ? "+" : ""}${c.change_pct.toFixed(2)}%`;
          const pctColor = c.change_pct > 0 ? colors.bullish : c.change_pct < 0 ? colors.bearish : colors.textMuted;
          return (
            <div
              key={c.symbol}
              style={{
                position: "relative",
                background: "var(--color-surface)",
                border: "0.5px solid var(--color-border-tertiary)",
                borderRadius: 8,
                padding: "12px 14px",
                borderLeft: `2px solid ${borderAccentForScore(c.score)}`,
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
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6 }}>
                <strong style={{ fontSize: 13, color: colors.text }}>{c.symbol}</strong>
                <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{c.score}</span>
              </div>
              <div style={{ marginTop: 4, fontSize: 16, fontWeight: 600, color: pctColor }}>{pctStr}</div>
              <div
                style={{
                  marginTop: 8,
                  height: 2,
                  borderRadius: 1,
                  background: "rgba(100,116,139,0.25)"
                }}
              >
                <div
                  style={{
                    width: `${c.score}%`,
                    height: "100%",
                    borderRadius: 1,
                    background: barFillForScore(c.score)
                  }}
                />
              </div>
              <div style={{ marginTop: 6, fontSize: 9, color: "var(--color-text-tertiary)" }}>
                {meta.cap} · {word}
              </div>
            </div>
          );
        })}
      </div>

      {/* Section 4 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 200px", minWidth: 0, fontSize: 11, lineHeight: 1.45 }}>
          <p style={{ margin: 0, fontWeight: 700, color: colors.text }}>{model.interpretation.line1}</p>
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

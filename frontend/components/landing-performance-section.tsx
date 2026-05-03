"use client";

import { motion } from "framer-motion";
import { BarChart3, CheckCircle2, Sparkles } from "lucide-react";
import type { PerformanceSummary, PatternAccuracyRow } from "@/lib/api/public-signals";

const MONO =
  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace";

const CARD = {
  background: "#0c1828",
  border: "1px solid rgba(0,180,255,0.1)",
  borderRadius: 10,
  padding: "20px 24px"
} as const;

const DEFAULT_PATTERN_SLOTS: { pattern_key: string; label: string }[] = [
  { pattern_key: "orb_long", label: "ORB Long" },
  { pattern_key: "vwap_reclaim", label: "VWAP Reclaim" },
  { pattern_key: "ema9_bounce", label: "9 EMA Bounce" },
  { pattern_key: "confluence", label: "Confluence" }
];

function barFillClass(tone: PatternAccuracyRow["tone"]): string {
  if (tone === "short") return "from-[#38bdf8] to-[#0ea5e9]";
  if (tone === "amber") return "from-[#f59e0b] to-[#d97706]";
  return "from-[#22c55e] to-[#16a34a]";
}

function AccuracySparkline({ values }: { values: number[] }) {
  const w = 320;
  const h = 80;
  const pad = 8;
  if (values.length < 2) return null;
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const span = Math.max(1e-6, maxV - minV);
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2);
    const y = pad + (1 - (v - minV) / span) * (h - pad * 2);
    return `${x},${y}`;
  });
  const d = `M ${pts.join(" L ")}`;
  const lastY = Number(pts[pts.length - 1]?.split(",")[1] ?? h);
  const areaD = `${d} L ${w - pad},${h - pad} L ${pad},${h - pad} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-20 w-full max-w-full" preserveAspectRatio="none" aria-hidden>
      {[0, 1, 2].map((i) => (
        <line
          key={i}
          x1={pad}
          x2={w - pad}
          y1={pad + (i * (h - pad * 2)) / 2}
          y2={pad + (i * (h - pad * 2)) / 2}
          stroke="rgba(0,180,255,0.06)"
          strokeWidth={1}
        />
      ))}
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(0,232,122,0.28)" />
          <stop offset="100%" stopColor="rgba(0,232,122,0)" />
        </linearGradient>
      </defs>
      <path d={areaD} fill="url(#sparkFill)" />
      <path d={d} fill="none" stroke="#00e87a" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      {values.map((v, i) => {
        const x = pad + (i / (values.length - 1)) * (w - pad * 2);
        const y = pad + (1 - (v - minV) / span) * (h - pad * 2);
        return <circle key={i} cx={x} cy={y} r={3} fill="#00e87a" stroke="#0c1828" strokeWidth={1} />;
      })}
    </svg>
  );
}

function PlaceholderSparkline() {
  const w = 320;
  const h = 80;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-20 w-full max-w-full text-slate-600" preserveAspectRatio="none" aria-hidden>
      {[0, 1, 2].map((i) => (
        <line
          key={i}
          x1={8}
          x2={w - 8}
          y1={12 + i * 28}
          y2={12 + i * 28}
          stroke="rgba(0,180,255,0.06)"
          strokeWidth={1}
        />
      ))}
      <path
        d={`M 24,${h / 2 + 6} L ${w / 2},${h / 2 - 4} L ${w - 24},${h / 2 + 2}`}
        fill="none"
        stroke="rgba(148,163,184,0.35)"
        strokeWidth={1.5}
        strokeDasharray="6 4"
      />
    </svg>
  );
}

export function LandingPerformanceSection({ summary }: { summary: PerformanceSummary | null }) {
  const hasPatternData = Boolean(summary?.pattern_breakdown && summary.pattern_breakdown.length > 0);
  const evaluated = summary?.signals_evaluated ?? 0;
  const overallPct = summary?.directional_accuracy_percent ?? 0;
  const sparkValues =
    hasPatternData && summary!.pattern_breakdown!.length >= 2
      ? summary!.pattern_breakdown!.map((r) => r.accuracy_percent)
      : [];

  const rows: { label: string; pct: number | null; tone: PatternAccuracyRow["tone"] }[] = hasPatternData
    ? summary!.pattern_breakdown!.map((r) => ({
        label: r.label,
        pct: r.accuracy_percent,
        tone: r.tone ?? (r.label.toLowerCase().includes("short") ? "short" : "green")
      }))
    : DEFAULT_PATTERN_SLOTS.map((s) => ({ label: s.label, pct: null, tone: "green" as const }));

  return (
    <section className="mx-auto max-w-7xl px-4 py-20 md:px-8">
      <div className="mx-auto max-w-3xl text-center">
        <p
          className="mb-3 uppercase"
          style={{
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: 4,
            color: "#00d4ff"
          }}
        >
          Transparency
        </p>
        <h2 className="text-3xl font-extrabold tracking-tight text-[#e8f4ff] md:text-4xl">Every signal. Published.</h2>
        <p className="mx-auto mt-3 max-w-lg text-sm text-slate-400">
          We track every signal against real market outcomes. Wins and losses.
        </p>
      </div>

      <div className="mx-auto mt-12 grid max-w-6xl grid-cols-1 gap-8 md:grid-cols-2">
        {/* Left: stat cards */}
        <div className="flex flex-col gap-4">
          {[
            {
              icon: Sparkles,
              iconClass: "text-cyan-400",
              value: "6",
              valueSuffix: "layers",
              suffixColor: "#00d4ff",
              label: "Independent signal engines per analysis"
            },
            {
              icon: CheckCircle2,
              iconClass: "text-emerald-400",
              value: "8AM",
              valueSuffix: "daily",
              suffixColor: "#00d4ff",
              label: "Pre-market intelligence briefing",
              note: "Before the market opens, every trading day"
            },
            {
              icon: BarChart3,
              iconClass: "text-cyan-400",
              value: "3",
              valueSuffix: "brokers",
              suffixColor: "#f59e0b",
              label: "IBKR, ETrade, Paper — execute from STOCVEST"
            }
          ].map((card) => (
            <motion.div
              key={card.label}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="flex items-center gap-5"
              style={CARD}
            >
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
                style={{ background: "rgba(0,180,255,0.08)", borderRadius: 8 }}
              >
                <card.icon className={`h-6 w-6 ${card.iconClass}`} aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[26px] leading-none text-slate-100">
                  {card.value}
                  <span className="ml-1 text-base font-semibold" style={{ color: card.suffixColor }}>
                    {card.valueSuffix}
                  </span>
                </p>
                <p className="mt-1 text-[11px] text-slate-500">{card.label}</p>
                {"note" in card && card.note ? (
                  <p className="mt-1 text-[10px] italic text-slate-600">{card.note}</p>
                ) : null}
              </div>
            </motion.div>
          ))}
        </div>

        {/* Right: accuracy card */}
        <motion.div initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} style={CARD}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500" style={{ fontSize: 12 }}>
              Signal accuracy by type
            </p>
            <div className="flex items-center gap-4 text-[10px] uppercase" style={{ fontFamily: MONO }}>
              <span className="flex items-center gap-1.5 text-slate-400">
                <span className="h-2 w-2 rounded-full bg-[#22c55e]" /> Long
              </span>
              <span className="flex items-center gap-1.5 text-slate-400">
                <span className="h-2 w-2 rounded-full bg-[#38bdf8]" /> Short
              </span>
            </div>
          </div>

          <div className="mb-2">
            {hasPatternData && sparkValues.length >= 2 ? (
              <AccuracySparkline values={sparkValues} />
            ) : (
              <PlaceholderSparkline />
            )}
            <div
              className="mt-1 flex justify-between font-mono text-[9px] uppercase text-slate-600"
              style={{ fontFamily: MONO }}
            >
              <span>launch</span>
              <span>week 2</span>
              <span>week 4</span>
            </div>
          </div>

          {evaluated > 0 && !hasPatternData ? (
            <p className="mb-3 text-center text-xs text-slate-400" style={{ fontFamily: MONO }}>
              Overall directional accuracy (resolved 1d):{" "}
              <span className="font-semibold text-slate-200">{overallPct.toFixed(1)}%</span> · n={evaluated}
            </p>
          ) : null}

          {!hasPatternData ? (
            <p className="mb-4 text-center text-xs text-slate-500">Building accuracy data — check back soon</p>
          ) : null}

          <div className="space-y-3">
            {rows.map((row) => (
              <div key={row.label} className="flex items-center gap-2">
                <span
                  className="w-[88px] shrink-0 font-mono text-[10px] text-slate-500"
                  style={{ fontFamily: MONO, width: 80 }}
                >
                  {row.label}
                </span>
                <div className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-sm bg-[rgba(0,180,255,0.08)]">
                  {row.pct != null ? (
                    <div
                      className={`absolute left-0 top-0 h-full rounded-sm bg-gradient-to-r ${barFillClass(row.tone)}`}
                      style={{ width: `${Math.min(100, Math.max(0, row.pct))}%` }}
                    />
                  ) : null}
                </div>
                <span
                  className="w-10 shrink-0 text-right font-mono text-[10px] text-slate-500"
                  style={{ fontFamily: MONO }}
                >
                  {row.pct != null ? `${row.pct.toFixed(0)}%` : ""}
                </span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className="mx-auto mt-10 grid max-w-6xl grid-cols-2 gap-4 rounded-lg border border-[rgba(0,180,255,0.1)] bg-[rgba(0,180,255,0.04)] p-6 sm:grid-cols-4"
        style={{ borderRadius: 10, padding: "20px 24px" }}
      >
        {[
          { n: "100%", l: "Signals published — wins and losses" },
          { n: "0", l: "Cherry-picked results" },
          { n: "24h", l: "Resolution window per signal" },
          { n: "0.5%", l: "Minimum move to count as resolved" }
        ].map((item) => (
          <div key={item.n} className="text-center sm:text-left">
            <p className="font-mono text-[22px] text-[#00d4ff]" style={{ fontFamily: MONO }}>
              {item.n}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">{item.l}</p>
          </div>
        ))}
      </motion.div>

      <p
        className="mx-auto mt-6 max-w-2xl text-center text-[10px] text-slate-500"
        style={{ fontFamily: MONO }}
      >
        Directional accuracy only — not trading returns. Past signal accuracy does not guarantee future results.
      </p>
    </section>
  );
}

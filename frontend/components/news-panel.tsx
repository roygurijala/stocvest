"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchTickerNewsPanel,
  tickerNewsCacheGet,
  type TickerNewsArticle,
  type TickerNewsPanelResponse
} from "@/lib/api/ticker-news-panel";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useIsMobileLayout } from "@/lib/hooks/use-is-mobile-layout";
import { useTheme } from "@/lib/theme-provider";
import { useHasAIExplanations } from "@/lib/api/user";

const INITIAL_VISIBLE = 10;

function nyYmd(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function ymdMinusOneCalendar(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const mdays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  if (leap) mdays[1] = 29;
  let d2 = d - 1;
  let m2 = m;
  let y2 = y;
  if (d2 < 1) {
    m2 -= 1;
    if (m2 < 1) {
      m2 = 12;
      y2 -= 1;
    }
    const md2 = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const leap2 = y2 % 4 === 0 && (y2 % 100 !== 0 || y2 % 400 === 0);
    if (leap2) md2[1] = 29;
    d2 = md2[m2 - 1];
  }
  return `${y2}-${String(m2).padStart(2, "0")}-${String(d2).padStart(2, "0")}`;
}

function groupBucketLabel(iso: string): string {
  const pub = new Date(iso);
  if (Number.isNaN(pub.getTime())) return "OLDER";
  const pubDay = nyYmd(pub);
  const nowDay = nyYmd(new Date());
  if (pubDay === nowDay) return "TODAY";
  if (pubDay === ymdMinusOneCalendar(nowDay)) return "YESTERDAY";
  const t0 = Date.parse(`${nowDay}T12:00:00Z`);
  const p0 = Date.parse(`${pubDay}T12:00:00Z`);
  const diffDays = Math.round((t0 - p0) / 86400000);
  if (diffDays >= 2 && diffDays < 7) {
    return pub.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short" });
  }
  return pub.toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
}

function groupArticles(articles: TickerNewsArticle[]): { label: string; items: TickerNewsArticle[] }[] {
  const sorted = [...articles].sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
  const out: { label: string; items: TickerNewsArticle[] }[] = [];
  let current = "";
  for (const a of sorted) {
    const label = groupBucketLabel(a.published_at);
    if (label !== current) {
      current = label;
      out.push({ label, items: [] });
    }
    out[out.length - 1].items.push(a);
  }
  return out;
}

export function sentimentDotClassForTests(score: number): string {
  if (score > 0.2) return "bg-emerald-500";
  if (score < -0.2) return "bg-rose-500";
  return "bg-slate-400";
}

function sentimentDotClass(score: number): string {
  return sentimentDotClassForTests(score);
}

function badgeClass(source: TickerNewsArticle["source"]): string {
  if (source === "benzinga") return "bg-orange-500/20 text-orange-200 border-orange-500/40";
  if (source === "sec_edgar") return "bg-sky-500/20 text-sky-100 border-sky-500/35";
  return "bg-slate-500/20 text-slate-200 border-slate-500/35";
}

/** @internal tests */
export function sourceBadgeClassForTests(source: TickerNewsArticle["source"]): string {
  return badgeClass(source);
}

function formatScore(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}`;
}

function panelSummary(data: TickerNewsPanelResponse | null): string {
  if (!data || data.articles.length === 0) return "";
  const n = data.total_found;
  if (!data.has_recent_news) {
    return `No articles in last ${data.recent_cutoff_hours}h · 20-day archive`;
  }
  const labels = new Set(data.articles.map((a) => a.sentiment_label));
  if (labels.has("bullish") && labels.has("bearish")) {
    return `${n} articles · Mixed`;
  }
  const avg =
    data.articles.reduce((acc, a) => acc + a.sentiment_score, 0) / Math.max(1, data.articles.length);
  if (avg > 0.2) {
    return `${n} articles · Bullish avg ${avg >= 0 ? "+" : ""}${avg.toFixed(2)}`;
  }
  if (avg < -0.2) {
    return `${n} articles · Bearish avg ${avg.toFixed(2)}`;
  }
  return `${n} articles · Mixed`;
}

export interface NewsPanelProps {
  symbol: string;
  isOpen: boolean;
  onClose: () => void;
  onLoaded?: () => void;
  /** Swing evidence uses a 5-day recent window; day stays at 8h (see `fetchTickerNewsPanel`). */
  newsTradingMode?: "day" | "swing";
  /** Composite direction for AI news synthesis (paid). */
  signalVerdict?: string;
}

export function NewsPanel({
  symbol,
  isOpen,
  onClose,
  onLoaded,
  newsTradingMode = "day",
  signalVerdict = "neutral"
}: NewsPanelProps) {
  const { colors } = useTheme();
  const mobile = useIsMobileLayout();
  const hasAIExplanations = useHasAIExplanations();
  const [data, setData] = useState<TickerNewsPanelResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  const [newsSyn, setNewsSyn] = useState<{ text: string; source: string; cached: boolean } | null>(null);
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  const sym = symbol.trim().toUpperCase();
  const recentHoursDefault = newsTradingMode === "swing" ? 120 : 8;

  const load = useCallback(async () => {
    if (!sym) return;
    const cached = tickerNewsCacheGet(sym, recentHoursDefault);
    if (cached) {
      setData(cached);
      onLoadedRef.current?.();
      return;
    }
    setLoading(true);
    try {
      const row = await fetchTickerNewsPanel(sym, { days: 20, limit: 20, newsTradingMode });
      setData(row);
      onLoadedRef.current?.();
    } finally {
      setLoading(false);
    }
  }, [sym, newsTradingMode, recentHoursDefault]);

  useEffect(() => {
    if (!isOpen || !sym) return;
    setVisibleCount(INITIAL_VISIBLE);
    void load();
  }, [isOpen, sym, load]);

  useEffect(() => {
    if (!isOpen || !sym || !hasAIExplanations || !data?.articles.length) {
      setNewsSyn(null);
      return;
    }
    let cancelled = false;
    const articles = data.articles.slice(0, 5).map((a) => ({
      title: a.title,
      article_id: a.id,
      published_at: a.published_at,
      sentiment_score: a.sentiment_score,
      sentiment: a.sentiment_label,
      url: a.url
    }));
    void (async () => {
      try {
        const res = await fetch("/api/stocvest/signals/ai/explanations", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: "news_synthesis",
            symbol: sym,
            verdict: signalVerdict,
            articles
          })
        });
        if (!res.ok) throw new Error("news synthesis failed");
        const j = (await res.json()) as { text?: string; source?: string; cached?: boolean };
        if (cancelled) return;
        setNewsSyn({
          text: String(j.text || ""),
          source: String(j.source || "deterministic"),
          cached: Boolean(j.cached)
        });
      } catch {
        if (!cancelled) setNewsSyn(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, sym, hasAIExplanations, data, signalVerdict]);

  const visibleArticles = useMemo(() => {
    if (!data?.articles.length) return [];
    return data.articles.slice(0, visibleCount);
  }, [data?.articles, visibleCount]);

  const groupedVisible = useMemo(() => {
    if (!visibleArticles.length) return [];
    return groupArticles(visibleArticles);
  }, [visibleArticles]);

  const remaining = data ? Math.max(0, data.articles.length - visibleCount) : 0;

  if (!isOpen) return null;

  const shell = (
    <div
      className="flex max-h-[92vh] flex-col shadow-2xl lg:h-full lg:max-h-screen"
      style={{
        background: colors.surface,
        borderLeft: mobile ? undefined : `1px solid ${colors.border}`,
        width: mobile ? "100%" : "min(420px, 100vw)",
        borderRadius: mobile ? `${borderRadius.xl} ${borderRadius.xl} 0 0` : 0
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="sticky top-0 z-10 flex flex-shrink-0 items-start justify-between gap-2 border-b px-4 py-3"
        style={{
          borderColor: colors.border,
          background: colors.surface
        }}
      >
        <div className="min-w-0">
          <h2 className="truncate text-base font-bold" style={{ color: colors.text }}>
            {sym} News
          </h2>
          {data && !loading ? (
            <p className="mt-1 text-xs" style={{ color: colors.textMuted }}>
              {panelSummary(data)}
            </p>
          ) : null}
          {!hasAIExplanations ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]" style={{ color: colors.textMuted }}>
              <span>✦ AI news synthesis available on Swing Pro</span>
              <Link
                href="/dashboard/settings"
                className="font-semibold underline-offset-2 hover:underline"
                style={{ color: colors.caution }}
              >
                Upgrade →
              </Link>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md border text-lg leading-none"
          style={{ borderColor: colors.border, color: colors.text, cursor: "pointer" }}
          aria-label="Close news panel"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-2">
        {hasAIExplanations && newsSyn?.text ? (
          <div
            className="mb-3 rounded-lg border px-3 py-2 text-xs leading-relaxed"
            style={{ borderColor: colors.border, color: colors.text, background: "rgba(59,130,246,0.06)" }}
          >
            <div className="mb-1 font-semibold" style={{ color: colors.textMuted }}>
              AI news read{newsSyn.cached ? " · cached today" : ""}
            </div>
            {newsSyn.text}
          </div>
        ) : null}
        {loading && !data ? (
          <div className="flex flex-col gap-3 py-2">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="animate-pulse rounded-lg border p-3"
                style={{ borderColor: colors.border, minHeight: 72 }}
              >
                <div className="mb-2 h-3 rounded bg-slate-600/40" style={{ width: "75%" }} />
                <div className="h-3 w-1/2 rounded bg-slate-600/25" />
              </div>
            ))}
          </div>
        ) : null}

        {data && !data.has_recent_news && data.articles.length > 0 ? (
          <div
            className="mb-3 rounded-lg border px-3 py-2 text-xs leading-snug"
            style={{
              borderColor: "rgba(245,158,11,0.45)",
              background: "rgba(245,158,11,0.08)",
              color: colors.text
            }}
          >
            <div className="font-semibold">Recent window: no articles in the last {data.recent_cutoff_hours} hours</div>
            <div style={{ color: colors.textMuted }}>
              <strong style={{ color: colors.caution }}>20-day archive</strong> — below are the newest items Polygon returned
              within the last 20 days for this symbol. Timestamps may be days old; read labels in each group.
            </div>
          </div>
        ) : null}

        {data && data.articles.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <span className="text-4xl opacity-40" aria-hidden>
              📰
            </span>
            <p className="max-w-sm text-sm leading-relaxed" style={{ color: colors.textMuted }}>
              No qualifying news for {sym} in the last 20 calendar days (after quality filters). Less-covered tickers may
              have sparse headlines.
            </p>
          </div>
        ) : null}

        {groupedVisible.length > 0 ? (
          <div className="flex flex-col gap-4">
            {groupedVisible.map((g) => (
              <div key={g.label}>
                <div
                  className="mb-2 border-b pb-1 text-[10px] font-bold uppercase tracking-wider"
                  style={{ color: colors.textMuted, borderColor: colors.border }}
                >
                  {g.label}
                </div>
                <ul className="flex flex-col gap-2 p-0">
                  {g.items.map((article) => {
                    const open = () => {
                      if (article.url) {
                        window.open(article.url, "_blank", "noopener,noreferrer");
                      }
                    };
                    const clickable = Boolean(article.url);
                    return (
                      <li key={article.id}>
                        <button
                          type="button"
                          className={`w-full rounded-lg border p-3 text-left transition-colors ${
                            clickable ? "cursor-pointer hover:bg-white/5" : "cursor-default opacity-90"
                          }`}
                          style={{ borderColor: colors.border }}
                          onClick={open}
                          disabled={!clickable}
                        >
                          <div className="flex gap-2">
                            <span
                              className={`mt-1.5 inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full ${sentimentDotClass(article.sentiment_score)}`}
                              aria-hidden
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-baseline gap-2">
                                <span
                                  className="text-xs font-semibold tabular-nums"
                                  style={{
                                    color:
                                      article.sentiment_score > 0.2
                                        ? colors.bullish
                                        : article.sentiment_score < -0.2
                                          ? colors.bearish
                                          : colors.textMuted
                                  }}
                                >
                                  {formatScore(article.sentiment_score)}
                                </span>
                                <span
                                  className="line-clamp-2 text-sm font-semibold leading-snug"
                                  style={{ color: colors.text }}
                                >
                                  {article.title}
                                </span>
                              </div>
                              <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px]">
                                <span
                                  className={`rounded px-1.5 py-0.5 font-semibold ${badgeClass(article.source)} border`}
                                >
                                  {article.source_label}
                                </span>
                                <span style={{ color: colors.textMuted }}>·</span>
                                <span style={{ color: colors.textMuted }}>{article.age_label}</span>
                              </div>
                            </div>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        ) : null}

        {remaining > 0 ? (
          <button
            type="button"
            className="mt-4 w-full rounded-lg border py-2.5 text-sm font-semibold"
            style={{ borderColor: colors.border, color: colors.text, cursor: "pointer" }}
            onClick={() => setVisibleCount((c) => c + remaining)}
          >
            Show {remaining} more article{remaining === 1 ? "" : "s"}
          </button>
        ) : null}

        <p className="mt-6 text-center text-[10px]" style={{ color: colors.textMuted }}>
          Sources: Benzinga · SEC EDGAR · Polygon
        </p>
      </div>
    </div>
  );

  return (
    <div
      className={
        mobile
          ? "fixed inset-0 z-[96] flex flex-col justify-end bg-black/50"
          : "fixed inset-0 z-[96] flex justify-end bg-black/40"
      }
      role="dialog"
      aria-modal="true"
      aria-label={`${sym} news`}
      onClick={onClose}
    >
      {mobile ? <div className="flex justify-center">{shell}</div> : shell}
    </div>
  );
}

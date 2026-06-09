"use client";

import { useEffect, useMemo, useState } from "react";
import { AddToWatchlistButton } from "@/components/add-to-watchlist-button";
import { OpenTradingRoomSetupButton } from "@/components/dashboard/trading-room/open-trading-room-setup-button";
import { ScannerDetailKeyLevels } from "@/components/scanner/terminal/scanner-detail-key-levels";
import { fetchDeskWhyMissing, type DeskTodayMode } from "@/lib/api/desk-today";
import type { SnapshotPayload } from "@/lib/api/market";
import type { ScannerEvaluationTraceRow } from "@/lib/scanner-setups-response";
import { borderRadius, spacing, typography, type ThemeColors } from "@/lib/design-system";
import { useSymbolName } from "@/lib/hooks/use-symbol-names";
import { useSignalComposite } from "@/lib/hooks/use-signal-composite";
import type { MarketEnvironmentPayload } from "@/lib/signal-evidence/market-environment-present";

type Props = {
  symbol: string;
  lane: DeskTodayMode;
  evaluationTrace: ScannerEvaluationTraceRow[];
  environment: MarketEnvironmentPayload | null;
  colors: ThemeColors;
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function fmtPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function fmtPrice(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

function biasFromComposite(body: Record<string, unknown> | null): "bull" | "bear" | "neutral" {
  if (!body) return "neutral";
  const dir = String(body.direction ?? body.trend_direction ?? "").trim().toLowerCase();
  if (dir === "long" || dir === "bull" || dir === "bullish" || dir === "up") return "bull";
  if (dir === "short" || dir === "bear" || dir === "bearish" || dir === "down") return "bear";
  const pct = num(body.change_percent);
  if (pct != null && pct > 0) return "bull";
  if (pct != null && pct < 0) return "bear";
  return "neutral";
}

export function ScannerSymbolLookupPanel({ symbol, lane, evaluationTrace, environment, colors }: Props) {
  const [whyLine, setWhyLine] = useState<string | null>(null);
  const [whyLoading, setWhyLoading] = useState(true);
  const [snap, setSnap] = useState<SnapshotPayload | null>(null);

  const { composite, isInitialLoading: compositeLoading } = useSignalComposite(symbol, lane);
  const body = (composite ?? null) as Record<string, unknown> | null;
  const knownCompany = String(body?.company_name ?? snap?.company_name ?? "").trim();
  const autoCompany = useSymbolName(knownCompany ? undefined : symbol);
  const company = knownCompany || autoCompany || null;

  const price =
    num(body?.last_trade_price) ??
    num(body?.last_price) ??
    num(snap?.last_trade_price) ??
    num(snap?.day_close);
  const changePct = num(body?.change_percent) ?? num(snap?.change_percent);
  const bias = biasFromComposite(body);
  const setupRead =
    typeof body?.signal_parameters === "string" && body.signal_parameters.trim()
      ? body.signal_parameters.trim()
      : null;

  const traceRows = evaluationTrace.filter(
    (r) => r.symbol === symbol && (lane === "swing" ? r.desk === "swing" : r.desk === "day")
  );

  const funnelNote = useMemo(() => {
    if (whyLoading) return "Checking desk funnel status…";
    if (whyLine) return whyLine;
    if (traceRows.length > 0) return "Not on today's actionable desk — see evaluation gates below.";
    return `${symbol} is not in the current scanner funnel. It may be outside the survivor set or below desk gates.`;
  }, [whyLoading, whyLine, traceRows.length, symbol]);

  useEffect(() => {
    let cancelled = false;
    setWhyLoading(true);
    void (async () => {
      try {
        const diag = await fetchDeskWhyMissing(lane, symbol);
        if (cancelled) return;
        setWhyLine(diag?.reason?.trim() || null);
      } catch {
        if (!cancelled) setWhyLine(null);
      } finally {
        if (!cancelled) setWhyLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [symbol, lane]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/stocvest/market/snapshots?symbols=${encodeURIComponent(symbol)}`,
          { cache: "no-store" }
        );
        if (!res.ok || cancelled) return;
        const json = (await res.json().catch(() => ({}))) as { snapshots?: SnapshotPayload[] };
        const row = Array.isArray(json.snapshots) ? json.snapshots[0] : null;
        if (!cancelled && row) setSnap(row);
      } catch {
        /* quote is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  const pctTone = changePct == null ? colors.textMuted : changePct >= 0 ? colors.bullish : colors.bearish;
  const biasLabel = bias === "bull" ? "Bullish" : bias === "bear" ? "Bearish" : "Neutral";

  return (
    <div style={{ padding: spacing[4] }}>
      <p
        style={{
          margin: 0,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: colors.textMuted
        }}
      >
        Symbol details
      </p>
      <h3 style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.lg, color: colors.text }}>{symbol}</h3>
      {company ? (
        <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted }}>{company}</p>
      ) : null}

      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: spacing[2],
          marginTop: spacing[2]
        }}
      >
        <span
          style={{
            fontSize: typography.scale.xl,
            fontWeight: 700,
            color: colors.text,
            fontVariantNumeric: "tabular-nums"
          }}
        >
          {compositeLoading && price == null ? "…" : fmtPrice(price)}
        </span>
        {changePct != null ? (
          <span
            style={{
              fontSize: typography.scale.base,
              fontWeight: 700,
              color: pctTone,
              fontVariantNumeric: "tabular-nums"
            }}
          >
            {fmtPct(changePct)}
          </span>
        ) : null}
      </div>

      <p style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.sm, color: colors.text }}>
        {biasLabel} · {lane === "day" ? "Day" : "Swing"} desk read
      </p>

      {setupRead ? (
        <div
          style={{
            marginTop: spacing[3],
            padding: spacing[3],
            borderRadius: borderRadius.md,
            border: `1px solid ${colors.border}`,
            background: colors.surfaceMuted ?? colors.surface
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: colors.textMuted
            }}
          >
            Setup read
          </p>
          <p style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.xs, color: colors.text, lineHeight: 1.55 }}>
            {setupRead}
          </p>
        </div>
      ) : compositeLoading ? (
        <p style={{ margin: `${spacing[3]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted }}>
          Loading setup context…
        </p>
      ) : null}

      <ScannerDetailKeyLevels symbol={symbol} lane={lane} colors={colors} environment={environment} bias={bias} />

      <div
        style={{
          marginTop: spacing[3],
          padding: spacing[3],
          borderRadius: borderRadius.md,
          border: `1px solid ${colors.border}`,
          background: colors.surfaceMuted ?? colors.surface
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: colors.textMuted
          }}
        >
          Desk funnel
        </p>
        <p style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.5 }}>
          {funnelNote}
        </p>
        {traceRows.length > 0 ? (
          <ul style={{ margin: `${spacing[2]} 0 0`, padding: 0, listStyle: "none", display: "grid", gap: spacing[2] }}>
            {traceRows.slice(0, 4).map((row, i) => (
              <li
                key={`${row.gate}-${i}`}
                style={{
                  padding: spacing[2],
                  borderRadius: borderRadius.sm,
                  border: `1px solid ${colors.border}`,
                  background: colors.background,
                  fontSize: typography.scale.xs,
                  color: colors.textMuted,
                  lineHeight: 1.45
                }}
              >
                <span style={{ fontWeight: 700, color: colors.text }}>{row.gate}</span>
                {" — "}
                {row.detail}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2], marginTop: spacing[4] }}>
        <OpenTradingRoomSetupButton
          symbol={symbol}
          lane={lane}
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: `${spacing[2]} ${spacing[3]}`,
            borderRadius: borderRadius.md,
            background: colors.accent,
            color: "#fff",
            fontSize: typography.scale.xs,
            fontWeight: 700,
            textDecoration: "none"
          }}
        >
          Open full setup →
        </OpenTradingRoomSetupButton>
        <AddToWatchlistButton symbol={symbol} />
      </div>
    </div>
  );
}

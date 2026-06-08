"use client";

import Link from "next/link";
import { AddToWatchlistButton } from "@/components/add-to-watchlist-button";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import type { ThemeColors } from "@/lib/design-system";
import type {
  ScannerTerminalGapRow,
  ScannerTerminalRadarGroup,
  ScannerTerminalSelection,
  ScannerTerminalSignalRow
} from "@/lib/scanner/terminal/scanner-terminal-model";

type Props = {
  selection: ScannerTerminalSelection;
  gaps: ScannerTerminalGapRow[];
  actionable: ScannerTerminalSignalRow[];
  developing: ScannerTerminalSignalRow[];
  radar: ScannerTerminalRadarGroup[];
  colors: ThemeColors;
};

function fmtPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function fmtPrice(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

function dashboardHref(symbol: string, lane: "day" | "swing"): string {
  return `/dashboard?symbol=${encodeURIComponent(symbol)}&lane=${lane}`;
}

function EmptyState({ colors }: { colors: ThemeColors }) {
  return (
    <div style={{ padding: spacing[6], textAlign: "center" }}>
      <p style={{ margin: 0, fontSize: typography.scale.sm, fontWeight: 600, color: colors.text }}>
        Select any symbol
      </p>
      <p style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.5 }}>
        Tap a row, card, or theme to see a quick preview. Open on dashboard for full detail.
      </p>
    </div>
  );
}

function CtaRow({ symbol, lane, colors }: { symbol: string; lane: "day" | "swing"; colors: ThemeColors }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2], marginTop: spacing[4] }}>
      <Link
        href={dashboardHref(symbol, lane)}
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
      </Link>
      <AddToWatchlistButton symbol={symbol} />
    </div>
  );
}

export function ScannerDetailPanel({ selection, gaps, actionable, developing, radar, colors }: Props) {
  if (!selection) return <EmptyState colors={colors} />;

  if (selection.kind === "gap") {
    const row = gaps.find((g) => g.symbol === selection.symbol);
    if (!row) return <EmptyState colors={colors} />;
    const lane = row.lane === "either" ? "swing" : row.lane;
    return (
      <div style={{ padding: spacing[4] }}>
        <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: colors.textMuted }}>
          Gap intelligence
        </p>
        <h3 style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.lg, color: colors.text }}>{row.symbol}</h3>
        {row.company ? (
          <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted }}>{row.company}</p>
        ) : null}
        <p style={{ margin: `${spacing[3]} 0 0`, fontSize: typography.scale.sm, color: colors.text }}>
          Gap {fmtPct(row.gapPct)} · <span style={{ color: colors.textMuted }}>{row.statusLabel}</span>
        </p>
        {row.note ? (
          <p style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.5 }}>
            {row.note}
          </p>
        ) : null}
        <CtaRow symbol={row.symbol} lane={lane} colors={colors} />
      </div>
    );
  }

  if (selection.kind === "radar") {
    const group = radar.find((g) => g.id === selection.groupId);
    if (!group) return <EmptyState colors={colors} />;
    const sym = selection.symbol ?? group.symbols[0];
    return (
      <div style={{ padding: spacing[4] }}>
        <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: colors.textMuted }}>
          On radar
        </p>
        <h3 style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.lg, color: colors.text }}>{group.title}</h3>
        {group.note ? (
          <p style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.5 }}>
            {group.note}
          </p>
        ) : null}
        <p style={{ margin: `${spacing[3]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted }}>
          {group.symbols.join(" · ")}
        </p>
        {sym ? <CtaRow symbol={sym} lane="swing" colors={colors} /> : null}
      </div>
    );
  }

  const row =
    actionable.find((r) => r.id === selection.id) ?? developing.find((r) => r.id === selection.id) ?? null;
  if (!row) return <EmptyState colors={colors} />;

  const biasLabel = row.bias === "bull" ? "Bullish" : row.bias === "bear" ? "Bearish" : "Neutral";
  const align =
    row.alignment != null ? `${row.alignment.aligned}/${row.alignment.total} layers` : null;

  if (row.state === "actionable") {
    return (
      <div style={{ padding: spacing[4] }}>
        <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: colors.bullish }}>
          Actionable
        </p>
        <h3 style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.lg, color: colors.text }}>{row.symbol}</h3>
        <p style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.sm, color: colors.text }}>
          {biasLabel}
          {align ? ` · ${align}` : ""}
          {row.riskReward != null ? ` · R/R ${row.riskReward.toFixed(1)}:1` : ""}
        </p>
        <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.sm, color: colors.textMuted }}>
          {fmtPrice(row.price)}
          {row.changePct != null ? ` (${fmtPct(row.changePct)})` : ""}
        </p>
        {row.verdict ? (
          <p style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.5 }}>
            {row.verdict}
          </p>
        ) : null}
        <CtaRow symbol={row.symbol} lane={row.lane} colors={colors} />
      </div>
    );
  }

  const progress =
    row.alignment && row.alignment.total > 0
      ? row.alignment.aligned / row.alignment.total
      : row.state === "near"
        ? 0.72
        : 0.45;

  return (
    <div style={{ padding: spacing[4] }}>
      <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: colors.caution }}>
        Developing
      </p>
      <h3 style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.lg, color: colors.text }}>{row.symbol}</h3>
      <p style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.sm, color: colors.text }}>
        {biasLabel}
        {align ? ` · ${align}` : ""}
      </p>
      <div
        style={{
          marginTop: spacing[3],
          height: 6,
          borderRadius: 999,
          background: colors.surfaceMuted ?? colors.border,
          overflow: "hidden"
        }}
      >
        <div
          style={{
            width: `${Math.round(progress * 100)}%`,
            height: "100%",
            background: row.bias === "bear" ? colors.bearish : colors.bullish,
            borderRadius: 999
          }}
        />
      </div>
      {row.blockerNote ? (
        <p style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted }}>
          Blocking: {row.blockerNote}
        </p>
      ) : null}
      <CtaRow symbol={row.symbol} lane={row.lane} colors={colors} />
    </div>
  );
}

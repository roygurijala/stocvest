"use client";

import type { ReactNode } from "react";
import { AddToWatchlistButton } from "@/components/add-to-watchlist-button";
import { OpenTradingRoomSetupButton } from "@/components/dashboard/trading-room/open-trading-room-setup-button";
import { ScannerDetailKeyLevels } from "@/components/scanner/terminal/scanner-detail-key-levels";
import { ScannerSymbolLookupPanel } from "@/components/scanner/terminal/scanner-symbol-lookup-panel";
import {
  ScannerThemeBriefPanel,
  ThemeSymbolBackBar
} from "@/components/scanner/terminal/scanner-theme-brief-panel";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import type { ThemeColors } from "@/lib/design-system";
import type { ScannerEvaluationTraceRow } from "@/lib/scanner-setups-response";
import type { MarketEnvironmentPayload } from "@/lib/signal-evidence/market-environment-present";
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
  environment: MarketEnvironmentPayload | null;
  evaluationTrace: ScannerEvaluationTraceRow[];
  colors: ThemeColors;
  onRadarSymbolSelect?: (symbol: string) => void;
  onRadarThemeBack?: () => void;
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

function EmptyState({ colors }: { colors: ThemeColors }) {
  return (
    <div style={{ padding: spacing[6], textAlign: "center" }}>
      <p style={{ margin: 0, fontSize: typography.scale.sm, fontWeight: 600, color: colors.text }}>
        Select any symbol
      </p>
      <p style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.5 }}>
        Tap a row, card, or theme to see a quick preview. Use the header search to jump to any symbol&apos;s full read.
      </p>
    </div>
  );
}

function MetricChip({ label, value, tone, colors }: { label: string; value: string; tone: string; colors: ThemeColors }) {
  return (
    <span
      style={{
        display: "inline-flex",
        flexDirection: "column",
        gap: 2,
        padding: `${spacing[1]} ${spacing[2]}`,
        borderRadius: borderRadius.sm,
        border: `1px solid ${colors.border}`,
        background: colors.background,
        minWidth: 72
      }}
    >
      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: colors.textMuted }}>
        {label}
      </span>
      <span style={{ fontSize: typography.scale.sm, fontWeight: 700, color: tone, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </span>
    </span>
  );
}

function DetailBlock({
  title,
  children,
  colors
}: {
  title: string;
  children: ReactNode;
  colors: ThemeColors;
}) {
  return (
    <div
      style={{
        marginTop: spacing[3],
        padding: spacing[3],
        borderRadius: borderRadius.md,
        border: `1px solid ${colors.border}`,
        background: colors.surfaceMuted ?? colors.surface
      }}
    >
      <p style={{ margin: 0, fontSize: 9.5, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: colors.textMuted }}>
        {title}
      </p>
      <div style={{ marginTop: spacing[2], fontSize: typography.scale.xs, color: colors.text, lineHeight: 1.55 }}>{children}</div>
    </div>
  );
}

function PriceHero({
  price,
  changePct,
  secondary,
  colors
}: {
  price: number | null;
  changePct: number | null;
  secondary?: string | null;
  colors: ThemeColors;
}) {
  const pctTone = changePct == null ? colors.textMuted : changePct >= 0 ? colors.bullish : colors.bearish;
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: spacing[2], marginTop: spacing[2] }}>
      <span style={{ fontSize: typography.scale.xl, fontWeight: 700, color: colors.text, fontVariantNumeric: "tabular-nums" }}>
        {fmtPrice(price)}
      </span>
      {changePct != null ? (
        <span style={{ fontSize: typography.scale.base, fontWeight: 700, color: pctTone, fontVariantNumeric: "tabular-nums" }}>
          {fmtPct(changePct)}
        </span>
      ) : null}
      {secondary ? (
        <span style={{ fontSize: typography.scale.xs, color: colors.textMuted, marginLeft: "auto" }}>{secondary}</span>
      ) : null}
    </div>
  );
}

function CtaRow({ symbol, lane, colors }: { symbol: string; lane: "day" | "swing"; colors: ThemeColors }) {
  return (
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
  );
}

export function ScannerDetailPanel({
  selection,
  gaps,
  actionable,
  developing,
  radar,
  environment,
  evaluationTrace,
  colors,
  onRadarSymbolSelect,
  onRadarThemeBack
}: Props) {
  if (!selection) return <EmptyState colors={colors} />;

  if (selection.kind === "lookup") {
    return (
      <ScannerSymbolLookupPanel
        symbol={selection.symbol}
        lane={selection.lane}
        evaluationTrace={evaluationTrace}
        environment={environment}
        colors={colors}
      />
    );
  }

  if (selection.kind === "gap") {
    const row = gaps.find((g) => g.symbol === selection.symbol);
    if (!row) return <EmptyState colors={colors} />;
    const lane = row.lane === "either" ? "swing" : row.lane;
    const statusTone =
      row.statusLabel === "accepted" ? colors.bullish : row.statusLabel === "fill watch" ? colors.caution : colors.textMuted;
    return (
      <div style={{ padding: spacing[4] }}>
        <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: colors.textMuted }}>
          Gap intelligence
        </p>
        <h3 style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.lg, color: colors.text }}>{row.symbol}</h3>
        {row.company ? (
          <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted }}>{row.company}</p>
        ) : null}
        <PriceHero
          price={row.currentPrice}
          changePct={row.gapPct}
          secondary={`Prev ${fmtPrice(row.prevClose)}`}
          colors={colors}
        />
        <p style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.sm, color: colors.text }}>
          Gap {row.gapDollars >= 0 ? "+" : ""}${Math.abs(row.gapDollars).toFixed(2)} from prev close ·{" "}
          <span style={{ color: statusTone, fontWeight: 700 }}>{row.statusLabel}</span>
        </p>

        {row.catalystHeadline ? (
          <DetailBlock title="Catalyst" colors={colors}>
            <p style={{ margin: 0, fontWeight: 600 }}>{row.catalystHeadline}</p>
            {row.catalystDescription ? <p style={{ margin: `${spacing[1]} 0 0`, color: colors.textMuted }}>{row.catalystDescription}</p> : null}
          </DetailBlock>
        ) : row.noCatalystWarning ? (
          <DetailBlock title="Catalyst" colors={colors}>
            <p style={{ margin: 0, color: colors.caution }}>{row.noCatalystWarning}</p>
          </DetailBlock>
        ) : null}

        <DetailBlock title="Fill watch reasoning" colors={colors}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2], marginBottom: spacing[2] }}>
            <MetricChip
              label="Volume"
              value={`${row.volumeVsAvg.toFixed(1)}× avg`}
              tone={row.volumeVsAvg >= 1.2 ? colors.bullish : row.volumeVsAvg >= 1 ? colors.caution : colors.textMuted}
              colors={colors}
            />
          </div>
          <p style={{ margin: 0 }}>{row.fillWatchReason}</p>
        </DetailBlock>

        <DetailBlock title="What to monitor" colors={colors}>
          <p style={{ margin: 0 }}>{row.monitorNote}</p>
        </DetailBlock>

        <ScannerDetailKeyLevels
          symbol={row.symbol}
          lane={lane}
          colors={colors}
          environment={environment}
        />

        {row.note && row.note !== row.catalystHeadline ? (
          <p style={{ margin: `${spacing[3]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.5 }}>
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

    if (selection.symbol) {
      const sym = selection.symbol.trim().toUpperCase();
      const gapRow = gaps.find((g) => g.symbol === sym);
      if (gapRow) {
        const lane = gapRow.lane === "either" ? "swing" : gapRow.lane;
        return (
          <div style={{ padding: spacing[4] }}>
            {onRadarThemeBack ? (
              <ThemeSymbolBackBar themeTitle={group.title} onBack={onRadarThemeBack} colors={colors} />
            ) : null}
            <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: colors.textMuted }}>
              Gap intelligence
            </p>
            <h3 style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.lg, color: colors.text }}>{gapRow.symbol}</h3>
            {gapRow.company ? (
              <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted }}>{gapRow.company}</p>
            ) : null}
            <PriceHero price={gapRow.currentPrice} changePct={gapRow.gapPct} secondary={`Prev ${fmtPrice(gapRow.prevClose)}`} colors={colors} />
            <CtaRow symbol={sym} lane={lane} colors={colors} />
          </div>
        );
      }

      const signalRow =
        actionable.find((r) => r.symbol === sym) ?? developing.find((r) => r.symbol === sym) ?? null;
      if (signalRow) {
        return (
          <div style={{ padding: spacing[4] }}>
            {onRadarThemeBack ? (
              <ThemeSymbolBackBar themeTitle={group.title} onBack={onRadarThemeBack} colors={colors} />
            ) : null}
            <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: colors.textMuted }}>
              {signalRow.state === "actionable" ? "Actionable" : "Developing"}
            </p>
            <h3 style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.lg, color: colors.text }}>{signalRow.symbol}</h3>
            <PriceHero price={signalRow.price} changePct={signalRow.changePct} colors={colors} />
            <CtaRow symbol={sym} lane={signalRow.lane} colors={colors} />
          </div>
        );
      }

      return (
        <div style={{ padding: spacing[4] }}>
          {onRadarThemeBack ? (
            <ThemeSymbolBackBar themeTitle={group.title} onBack={onRadarThemeBack} colors={colors} />
          ) : null}
          <ScannerSymbolLookupPanel
            symbol={sym}
            lane="swing"
            evaluationTrace={evaluationTrace}
            environment={environment}
            colors={colors}
          />
        </div>
      );
    }

    return (
      <ScannerThemeBriefPanel
        group={group}
        gaps={gaps}
        onSelectSymbol={(symbol) => onRadarSymbolSelect?.(symbol)}
        colors={colors}
      />
    );
  }

  const row =
    actionable.find((r) => r.id === selection.id) ?? developing.find((r) => r.id === selection.id) ?? null;
  if (!row) return <EmptyState colors={colors} />;

  const biasLabel = row.bias === "bull" ? "Bullish" : row.bias === "bear" ? "Bearish" : "Neutral";
  const align =
    row.alignment != null ? `${row.alignment.aligned}/${row.alignment.total} layers` : null;
  const stateLabel = row.state === "actionable" ? "Actionable" : "Developing";
  const stateColor = row.state === "actionable" ? colors.bullish : colors.caution;

  const signalBody = (
    <>
      <p style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.sm, color: colors.text }}>
        {biasLabel}
        {align ? ` · ${align}` : ""}
      </p>
      {row.verdict ? (
        <p style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.5 }}>
          {row.verdict}
        </p>
      ) : null}
      {row.triggers.length > 0 ? (
        <ul style={{ margin: `${spacing[2]} 0 0`, paddingLeft: spacing[4], fontSize: typography.scale.xs, color: colors.textMuted }}>
          {row.triggers.slice(0, 4).map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      ) : null}
      <ScannerDetailKeyLevels
        symbol={row.symbol}
        lane={row.lane}
        colors={colors}
        environment={environment}
        bias={row.bias}
      />
    </>
  );

  if (row.state === "actionable") {
    return (
      <div style={{ padding: spacing[4] }}>
        <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: stateColor }}>
          {stateLabel}
        </p>
        <h3 style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.lg, color: colors.text }}>{row.symbol}</h3>
        {row.company ? (
          <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted }}>{row.company}</p>
        ) : null}
        <PriceHero price={row.price} changePct={row.changePct} colors={colors} />
        {signalBody}
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
      <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: stateColor }}>
        {stateLabel}
      </p>
      <h3 style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.lg, color: colors.text }}>{row.symbol}</h3>
      {row.company ? (
        <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted }}>{row.company}</p>
      ) : null}
      <PriceHero price={row.price} changePct={row.changePct} colors={colors} />
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
      {signalBody}
      <CtaRow symbol={row.symbol} lane={row.lane} colors={colors} />
    </div>
  );
}

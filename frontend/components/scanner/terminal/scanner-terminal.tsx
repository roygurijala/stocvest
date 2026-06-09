"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ChevronDown, Search } from "lucide-react";
import { useTheme } from "@/lib/theme-provider";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import {
  biasPillStyle,
  gapCardChrome,
  radarCardChrome,
  sectorAccentFromGroupId,
  selectionAccentColor,
  signalCardChrome,
  STATE_LABEL,
  stateTone
} from "@/lib/scanner/terminal/scanner-terminal-present";
import { AppSessionHeader } from "@/components/app-session-header";
import { useMarketEnvironment } from "@/lib/hooks/use-market-environment";
import { useSessionHeaderMarket } from "@/lib/hooks/use-session-header-market";
import { useStackedLayout } from "@/lib/hooks/use-stacked-layout";
import type { ScannerOverview } from "@/lib/api/scanner";
import type { DeskTodayData } from "@/lib/api/desk-today";
import type { ScannerEvaluationTraceRow } from "@/lib/scanner-setups-response";
import type { ScannerNearQualificationRow } from "@/lib/scanner-scan-summary";
import { environmentSessionCardHint } from "@/lib/signal-evidence/environment-session-hint";
import type { MarketEnvironmentPayload } from "@/lib/signal-evidence/market-environment-present";
import Link from "next/link";
import {
  buildScannerTerminalSections,
  DEFAULT_SCANNER_TERMINAL_FILTERS,
  isTickerSearchQuery,
  selectionTitle,
  type ScannerTerminalFilters,
  type ScannerTerminalGapRow,
  type ScannerTerminalRadarGroup,
  type ScannerTerminalSelection,
  type ScannerTerminalSignalRow
} from "@/lib/scanner/terminal/scanner-terminal-model";
import { ScannerDetailPanel } from "@/components/scanner/terminal/scanner-detail-panel";
import { ScannerTerminalDetailSheet } from "@/components/scanner/terminal/scanner-terminal-detail-sheet";
import { ScannerTerminalQuietPanel } from "@/components/scanner/terminal/scanner-terminal-quiet-panel";
import type { ScannerScanSummary } from "@/lib/scanner-scan-summary";
import type { ScannerSynthesis } from "@/lib/scanner-synthesis";
import type { SectorRotationChip } from "@/lib/market-context/types";
import type { IpoEcosystemPayload } from "@/lib/api/fetch-ipo-ecosystems";

type Props = {
  overview: ScannerOverview;
  swingDesk: DeskTodayData | null;
  dayDesk: DeskTodayData | null;
  nearQualification: ScannerNearQualificationRow[];
  watchlistSymbols: string[];
  dayTradingSurfaces: boolean;
  evaluationTrace?: ScannerEvaluationTraceRow[];
  scanSummary?: ScannerScanSummary | null;
  synthesis?: ScannerSynthesis | null;
  sectorRotation?: SectorRotationChip[];
  ipoEcosystems?: IpoEcosystemPayload[];
  showPreviewBadge?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  sessionUpdatedAtIso?: string | null;
};

function SectionHeader({
  title,
  count,
  open,
  onToggle,
  accent,
  colors
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  accent?: string;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const rail = accent ?? colors.accent;
  return (
    <button
      type="button"
      className="scanner-terminal-section-header"
      data-open={open ? "true" : "false"}
      onClick={onToggle}
      aria-expanded={open}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: spacing[2],
        marginBottom: spacing[2],
        padding: `${spacing[2]} ${spacing[3]}`,
        borderRadius: borderRadius.md,
        border: `1px solid ${open ? `${rail}55` : colors.border}`,
        borderLeft: `3px solid ${rail}`,
        background: open ? `${rail}12` : colors.surfaceMuted ?? colors.surface,
        cursor: "pointer",
        textAlign: "left"
      }}
    >
      <ChevronDown
        size={18}
        aria-hidden
        style={{
          flexShrink: 0,
          color: rail,
          transform: open ? "rotate(0deg)" : "rotate(-90deg)",
          transition: "transform 0.18s ease"
        }}
      />
      <span
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: colors.textMuted,
          whiteSpace: "nowrap"
        }}
      >
        {title}
      </span>
      <span
        style={{
          fontSize: typography.scale.sm,
          fontWeight: 700,
          color: rail,
          fontVariantNumeric: "tabular-nums",
          minWidth: 20
        }}
      >
        {count}
      </span>
      <span
        style={{
          flex: 1,
          height: 1,
          background: `linear-gradient(90deg, ${rail}55 0%, ${colors.border} 70%, transparent 100%)`
        }}
      />
      <span style={{ fontSize: typography.scale.xs, color: colors.textMuted, fontWeight: 600 }}>
        {open ? "Collapse" : "Expand"}
      </span>
    </button>
  );
}

function FilterPill({
  label,
  active,
  onClick,
  colors
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  return (
    <button
      type="button"
      className="scanner-terminal-filter-pill"
      data-active={active ? "true" : "false"}
      onClick={onClick}
      style={{
        border: `1px solid ${active ? colors.accent : colors.border}`,
        background: active ? "rgba(46,139,255,.14)" : colors.surfaceMuted ?? colors.surface,
        color: active ? colors.accent : colors.textMuted
      }}
    >
      {label}
    </button>
  );
}

function GapRow({
  row,
  selected,
  onSelect,
  colors
}: {
  row: ScannerTerminalGapRow;
  selected: boolean;
  onSelect: () => void;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const pctTone = row.gapPct >= 0 ? colors.bullish : colors.bearish;
  const chrome = gapCardChrome(row, selected, colors);
  return (
    <button
      type="button"
      className="scanner-terminal-card"
      onClick={onSelect}
      style={{
        padding: spacing[3],
        ...chrome,
        ...(row.isIpoWatch
          ? { borderStyle: "dashed", borderColor: "rgba(245,158,11,0.45)", background: "rgba(245,158,11,0.06)" }
          : null)
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: spacing[2] }}>
        <span style={{ fontSize: typography.scale.base, fontWeight: 700, color: colors.text }}>{row.symbol}</span>
        <span
          style={{
            color: pctTone,
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
            fontSize: typography.scale.sm
          }}
        >
          {row.gapPct >= 0 ? "+" : ""}
          {row.gapPct.toFixed(1)}%
        </span>
      </div>
      <div style={{ marginTop: spacing[1], fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.4 }}>
        <span style={{ fontWeight: 700, color: pctTone }}>{row.statusLabel}</span>
        {row.note ? ` · ${row.note}` : ""}
      </div>
    </button>
  );
}

function SignalRow({
  row,
  highlight,
  selected,
  onSelect,
  sessionHint,
  colors
}: {
  row: ScannerTerminalSignalRow;
  highlight?: boolean;
  selected: boolean;
  onSelect: () => void;
  sessionHint?: string | null;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const sTone = stateTone(row.state, colors);
  const pctTone =
    row.changePct == null ? colors.textMuted : row.changePct >= 0 ? colors.bullish : colors.bearish;
  return (
    <button
      type="button"
      className="scanner-terminal-card"
      onClick={onSelect}
      style={{
        padding: spacing[3],
        display: "flex",
        flexDirection: "column",
        gap: spacing[1],
        opacity: row.state === "cooling" ? 0.78 : 1,
        ...signalCardChrome(row, selected, !!highlight, colors)
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: spacing[2] }}>
        <span style={{ fontSize: typography.scale.base, fontWeight: 700, color: colors.text }}>{row.symbol}</span>
        <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          {row.price != null ? (
            <span style={{ fontSize: typography.scale.sm, fontWeight: 600, color: pctTone }}>${row.price.toFixed(2)}</span>
          ) : null}
          {row.changePct != null ? (
            <span style={{ fontSize: typography.scale.xs, color: pctTone, fontVariantNumeric: "tabular-nums" }}>
              {row.changePct >= 0 ? "+" : ""}
              {row.changePct.toFixed(1)}%
            </span>
          ) : null}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: spacing[2], flexWrap: "wrap" }}>
        <span style={biasPillStyle(row.bias, colors)}>
          {row.bias === "bull" ? "Bullish" : row.bias === "bear" ? "Bearish" : "Neutral"}
        </span>
        <span style={{ fontSize: typography.scale.xs, fontWeight: 700, color: sTone }}>{STATE_LABEL[row.state]}</span>
        {row.alignment ? (
          <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>
            {row.alignment.aligned}/{row.alignment.total} layers
          </span>
        ) : null}
        {row.riskReward != null ? (
          <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>R/R {row.riskReward.toFixed(1)}:1</span>
        ) : null}
      </div>
      {row.verdict ? (
        <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.4 }}>{row.verdict}</p>
      ) : null}
      {row.blockerNote && !highlight ? (
        <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted }}>{row.blockerNote}</p>
      ) : null}
      {sessionHint ? (
        <p style={{ margin: 0, fontSize: 10, color: colors.caution, fontWeight: 600 }}>{sessionHint}</p>
      ) : null}
    </button>
  );
}

function DevelopingSubLabel({ children, colors }: { children: string; colors: ReturnType<typeof useTheme>["colors"] }) {
  return (
    <p
      style={{
        margin: `${spacing[2]} 0 ${spacing[1]}`,
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: colors.textMuted
      }}
    >
      {children}
    </p>
  );
}

function RadarCard({
  group,
  selected,
  onSelect,
  colors
}: {
  group: ScannerTerminalRadarGroup;
  selected: boolean;
  onSelect: () => void;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const accent = sectorAccentFromGroupId(group.id);
  return (
    <button
      type="button"
      className="scanner-terminal-card"
      onClick={onSelect}
      style={{
        padding: spacing[3],
        ...radarCardChrome(group.id, selected, colors)
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: accent
        }}
      >
        {group.title}
      </p>
      <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, fontWeight: 600, color: colors.text }}>
        {group.symbols.slice(0, 4).join(" · ")}
        {group.symbols.length > 4 ? ` +${group.symbols.length - 4}` : ""}
      </p>
      {group.note ? (
        <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.4 }}>
          {group.note}
        </p>
      ) : null}
    </button>
  );
}

export function ScannerTerminal({
  overview,
  swingDesk,
  dayDesk,
  nearQualification,
  watchlistSymbols,
  dayTradingSurfaces,
  evaluationTrace = [],
  scanSummary = null,
  synthesis = null,
  sectorRotation = [],
  ipoEcosystems = [],
  showPreviewBadge = false,
  onRefresh,
  refreshing = false,
  sessionUpdatedAtIso = null
}: Props) {
  const { colors } = useTheme();
  const environment = useMarketEnvironment("swing");
  const isMobile = useStackedLayout(899);
  const sessionMarket = useSessionHeaderMarket({
    scannerSpyPct: overview.spyPct,
    scannerQqqPct: overview.qqqPct,
    scannerRegimeLabel: overview.regimeLabel,
    scannerError: overview.error,
    fallbackUpdatedAtIso: sessionUpdatedAtIso
  });
  const [filters, setFilters] = useState<ScannerTerminalFilters>(DEFAULT_SCANNER_TERMINAL_FILTERS);
  const [selection, setSelection] = useState<ScannerTerminalSelection>(null);
  const narrowLayout = isMobile;
  const [openSections, setOpenSections] = useState({
    gaps: true,
    ipoWatch: true,
    actionable: true,
    developing: true,
    radar: true
  });

  const watchSet = useMemo(() => new Set(watchlistSymbols.map((s) => s.trim().toUpperCase())), [watchlistSymbols]);

  const sections = useMemo(
    () =>
      buildScannerTerminalSections({
        filters,
        gapIntelligence: overview.gapIntelligence,
        gapIpoWatch: overview.gapIpoWatch,
        setups: overview.setups,
        swingDesk,
        dayDesk,
        nearQualification,
        dayTradingSurfaces,
        watchlistSymbols: watchSet,
        sectorRotation,
        ipoEcosystems
      }),
    [filters, overview, swingDesk, dayDesk, nearQualification, dayTradingSurfaces, watchSet, sectorRotation, ipoEcosystems]
  );

  const feedStateForHint = (state: ScannerTerminalSignalRow["state"]) =>
    state === "actionable" ? "actionable" : state === "near" ? "near" : "potential";

  const sessionHintForRow = (row: ScannerTerminalSignalRow, env: MarketEnvironmentPayload | null) => {
    if (!env) return null;
    return environmentSessionCardHint(env, row.lane, feedStateForHint(row.state));
  };

  const allVisibleSymbols = useMemo(() => {
    const set = new Set<string>();
    for (const g of [...sections.gaps, ...sections.ipoWatch]) set.add(g.symbol);
    for (const r of [...sections.actionable, ...sections.developing]) set.add(r.symbol);
    return set;
  }, [sections]);

  useEffect(() => {
    const ticker = isTickerSearchQuery(filters.query);
    if (!ticker) return;
    if (allVisibleSymbols.has(ticker)) return;
    const lane = filters.mode === "day" ? "day" : "swing";
    setSelection({ kind: "lookup", symbol: ticker, lane });
  }, [filters.query, filters.mode, allVisibleSymbols]);

  const shellStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: narrowLayout ? "1fr" : "minmax(0, 1fr) minmax(280px, 340px)",
    gap: spacing[4],
    minHeight: narrowLayout ? undefined : "calc(100vh - 4rem)",
    paddingBottom: narrowLayout && selection ? spacing[6] : undefined
  };

  const detailPanel = (
    <ScannerDetailPanel
      selection={selection}
      gaps={[...sections.gaps, ...sections.ipoWatch]}
      actionable={sections.actionable}
      developing={sections.developing}
      radar={sections.radar}
      environment={environment}
      evaluationTrace={evaluationTrace}
      colors={colors}
    />
  );

  const sheetTitle = selectionTitle(selection, sections);

  const detailAccent = useMemo(() => {
    if (!selection) return colors.accent;
    if (selection.kind === "gap") {
      const row =
        sections.gaps.find((g) => g.symbol === selection.symbol) ??
        sections.ipoWatch.find((g) => g.symbol === selection.symbol);
      return selectionAccentColor({ kind: "gap", gapPct: row?.gapPct }, colors);
    }
    if (selection.kind === "radar") {
      return selectionAccentColor({ kind: "radar", groupId: selection.groupId }, colors);
    }
    if (selection.kind === "lookup") return colors.accent;
    const row =
      sections.actionable.find((r) => r.id === selection.id) ??
      sections.developing.find((r) => r.id === selection.id);
    return selectionAccentColor({ kind: "signal", state: row?.state }, colors);
  }, [selection, sections, colors]);

  const headerCounts = useMemo(
    () => ({
      actionable: sections.actionableCount,
      near: sections.developingClosest.length,
      potential: sections.developingAlso.length,
      cooling: 0
    }),
    [sections]
  );

  const openSymbolFromHeader = (symbol: string) => {
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;
    const lane = filters.mode === "day" ? "day" : "swing";
    setSelection({ kind: "lookup", symbol: sym, lane });
  };

  const bleed = isMobile ? spacing[4] : spacing[6];

  const toggleSection = (key: keyof typeof openSections) =>
    setOpenSections((s) => ({ ...s, [key]: !s[key] }));

  const previewBadge = showPreviewBadge ? (
    <span
      style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: colors.caution,
        padding: `2px ${spacing[2]}`,
        border: `1px solid ${colors.caution}`,
        borderRadius: borderRadius.sm
      }}
    >
      Preview
    </span>
  ) : null;

  return (
    <section style={{ display: "grid", gap: 0, color: colors.text }}>
      <AppSessionHeader
        regimeLabel={sessionMarket.regimeLabel}
        spyPct={sessionMarket.spyPct}
        qqqPct={sessionMarket.qqqPct}
        iwmPct={sessionMarket.iwmPct}
        vixLevel={sessionMarket.vixLevel}
        marketStatusLabel={sessionMarket.marketStatusLabel}
        marketOpen={sessionMarket.marketOpen}
        counts={headerCounts}
        updatedAtIso={sessionMarket.updatedAtIso}
        onOpenSymbol={openSymbolFromHeader}
        bleed={bleed}
        isMobile={isMobile}
        colors={colors}
        badge={previewBadge}
        searchPlaceholder="Jump to a symbol or company…"
      />

      <div style={{ display: "flex", flexDirection: "column", gap: spacing[3], padding: spacing[4] }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: spacing[2] }}>
        {(["all", "day", "swing"] as const).map((mode) => (
          <FilterPill
            key={mode}
            label={mode === "all" ? "All" : mode === "day" ? "Day" : "Swing"}
            active={filters.mode === mode}
            onClick={() => setFilters((f) => ({ ...f, mode }))}
            colors={colors}
          />
        ))}
        <FilterPill
          label="Watchlist"
          active={filters.watchlistOnly}
          onClick={() => setFilters((f) => ({ ...f, watchlistOnly: !f.watchlistOnly }))}
          colors={colors}
        />
        {(["all", "actionable", "developing"] as const).map((state) => (
          <FilterPill
            key={state}
            label={state === "all" ? "All states" : state === "actionable" ? "Actionable" : "Developing"}
            active={filters.state === state}
            onClick={() => setFilters((f) => ({ ...f, state }))}
            colors={colors}
          />
        ))}
        {onRefresh ? (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            style={{
              marginLeft: "auto",
              padding: `${spacing[1]} ${spacing[2]}`,
              borderRadius: borderRadius.md,
              border: `1px solid ${colors.border}`,
              background: colors.surfaceMuted ?? colors.surface,
              color: colors.textMuted,
              fontSize: typography.scale.xs,
              fontWeight: 600,
              cursor: refreshing ? "wait" : "pointer"
            }}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        ) : null}
      </div>

      <div style={shellStyle}>
        <div style={{ display: "flex", flexDirection: "column", gap: spacing[4], minWidth: 0 }}>
          {sections.actionableCount === 0 ? (
            <ScannerTerminalQuietPanel
              scanSummary={scanSummary}
              synthesis={synthesis}
              swingDesk={swingDesk}
              dayDesk={dayDesk}
              developingClosest={sections.developingClosest}
              colors={colors}
              onSelectSymbol={(symbol, lane) => setSelection({ kind: "lookup", symbol, lane })}
            />
          ) : null}

          <div
            className="scanner-terminal-search-wrap"
            style={{ width: narrowLayout ? "100%" : "60%", maxWidth: "100%" }}
          >
            <p
              style={{
                margin: `0 0 ${spacing[1]}`,
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: colors.accent
              }}
            >
              Funnel search
            </p>
            <div className="scanner-terminal-search-field">
              <Search size={16} aria-hidden className="scanner-terminal-search-icon" />
              <input
                type="search"
                className="scanner-terminal-search"
                placeholder="Filter funnel or look up a symbol…"
                value={filters.query}
                onChange={(e) => {
                  setFilters((f) => ({ ...f, query: e.target.value }));
                  if (!e.target.value.trim()) setSelection(null);
                }}
                style={{
                  color: colors.text,
                  fontSize: typography.scale.sm
                }}
              />
            </div>
          </div>

          <section>
            <SectionHeader
              title="Gap intelligence — pre-market & opening hour"
              count={sections.gaps.length}
              open={openSections.gaps}
              onToggle={() => toggleSection("gaps")}
              accent={colors.caution}
              colors={colors}
            />
            {openSections.gaps ? (
              <div style={{ display: "grid", gap: spacing[2] }}>
                {sections.gaps.length === 0 ? (
                  <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted }}>No gap flags in this filter.</p>
                ) : (
                  sections.gaps.map((row) => (
                    <GapRow
                      key={row.symbol}
                      row={row}
                      selected={selection?.kind === "gap" && selection.symbol === row.symbol}
                      onSelect={() => setSelection({ kind: "gap", symbol: row.symbol })}
                      colors={colors}
                    />
                  ))
                )}
              </div>
            ) : null}
          </section>

          {sections.ipoWatch.length > 0 ? (
            <section>
              <SectionHeader
                title="IPO watch — unscored"
                count={sections.ipoWatch.length}
                open={openSections.ipoWatch}
                onToggle={() => toggleSection("ipoWatch")}
                accent={colors.caution}
                colors={colors}
              />
              {openSections.ipoWatch ? (
                <div style={{ display: "grid", gap: spacing[2] }}>
                  <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.45 }}>
                    New listings excluded from ranked movers. Gaps shown for monitoring only — not evaluated by the signal
                    engine.
                  </p>
                  {sections.ipoWatch.map((row) => (
                    <GapRow
                      key={`ipo-${row.symbol}`}
                      row={row}
                      selected={selection?.kind === "gap" && selection.symbol === row.symbol}
                      onSelect={() => setSelection({ kind: "gap", symbol: row.symbol })}
                      colors={colors}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {sections.actionable.length > 0 ? (
            <section>
              <SectionHeader
                title="Actionable now — all gates cleared"
                count={sections.actionable.length}
                open={openSections.actionable}
                onToggle={() => toggleSection("actionable")}
                accent={colors.bullish}
                colors={colors}
              />
              {openSections.actionable ? (
                <div style={{ display: "grid", gap: spacing[2] }}>
                  {sections.actionable.map((row) => (
                    <SignalRow
                      key={row.id}
                      row={row}
                      highlight
                      selected={selection?.kind === "signal" && selection.id === row.id}
                      onSelect={() => setSelection({ kind: "signal", id: row.id })}
                      sessionHint={sessionHintForRow(row, environment)}
                      colors={colors}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {sections.developing.length > 0 ? (
            <section>
              <SectionHeader
                title="Developing — building toward actionable"
                count={sections.developing.length}
                open={openSections.developing}
                onToggle={() => toggleSection("developing")}
                accent={colors.caution}
                colors={colors}
              />
              {openSections.developing ? (
                <div style={{ display: "grid", gap: spacing[2] }}>
                  {sections.developingClosest.length > 0 ? (
                    <>
                      <DevelopingSubLabel colors={colors}>Closest to triggering</DevelopingSubLabel>
                      {sections.developingClosest.map((row) => (
                        <SignalRow
                          key={row.id}
                          row={row}
                          selected={selection?.kind === "signal" && selection.id === row.id}
                          onSelect={() => setSelection({ kind: "signal", id: row.id })}
                          sessionHint={sessionHintForRow(row, environment)}
                          colors={colors}
                        />
                      ))}
                    </>
                  ) : null}
                  {sections.developingAlso.length > 0 ? (
                    <>
                      <DevelopingSubLabel colors={colors}>Also developing</DevelopingSubLabel>
                      {sections.developingAlso.map((row) => (
                        <SignalRow
                          key={row.id}
                          row={row}
                          selected={selection?.kind === "signal" && selection.id === row.id}
                          onSelect={() => setSelection({ kind: "signal", id: row.id })}
                          colors={colors}
                        />
                      ))}
                    </>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}

          <section>
            <SectionHeader
              title="On radar — active themes today"
              count={sections.radar.reduce((n, g) => n + g.symbols.length, 0)}
              open={openSections.radar}
              onToggle={() => toggleSection("radar")}
              accent={colors.accent}
              colors={colors}
            />
            {openSections.radar ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(12rem, 1fr))", gap: spacing[2] }}>
                {sections.radar.length === 0 ? (
                  <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted }}>Radar themes populate after desk batch runs.</p>
                ) : (
                  sections.radar.map((group) => (
                    <RadarCard
                      key={group.id}
                      group={group}
                      selected={selection?.kind === "radar" && selection.groupId === group.id}
                      onSelect={() => setSelection({ kind: "radar", groupId: group.id })}
                      colors={colors}
                    />
                  ))
                )}
              </div>
            ) : null}
          </section>
        </div>

        {!narrowLayout ? (
          <aside
            className="scanner-terminal-detail-rail"
            style={{
              position: "sticky",
              top: spacing[4],
              alignSelf: "start",
              border: `1px solid ${colors.border}`,
              background: colors.surface,
              minHeight: 280
            }}
          >
            <div className="scanner-terminal-detail-rail-accent" style={{ background: detailAccent }} />
            {detailPanel}
          </aside>
        ) : null}
      </div>

      {narrowLayout ? (
        <ScannerTerminalDetailSheet
          open={selection != null}
          onClose={() => setSelection(null)}
          title={sheetTitle}
          accent={detailAccent}
          colors={colors}
        >
          {detailPanel}
        </ScannerTerminalDetailSheet>
      ) : null}

      <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, textAlign: "right" }}>
        <Link href="/dashboard/scanner/classic" style={{ color: colors.textMuted, textDecoration: "underline" }}>
          Classic scanner view
        </Link>
      </p>
      </div>
    </section>
  );
}

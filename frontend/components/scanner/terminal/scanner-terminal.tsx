"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useTheme } from "@/lib/theme-provider";
import { borderRadius, roleAccents, spacing, typography } from "@/lib/design-system";
import { MarketEnvironmentStrip } from "@/components/market-environment-strip";
import { useMarketEnvironment } from "@/lib/hooks/use-market-environment";
import { useMacroContext } from "@/lib/hooks/use-macro-context";
import { mapMacroRegimeToLabel } from "@/lib/market-context/regime";
import { isUsRegularSessionOpenEt } from "@/lib/market-hours-et";
import type { ScannerOverview } from "@/lib/api/scanner";
import type { DeskTodayData } from "@/lib/api/desk-today";
import type { ScannerEvaluationTraceRow } from "@/lib/scanner-setups-response";
import type { ScannerNearQualificationRow } from "@/lib/scanner-scan-summary";
import { environmentSessionCardHint } from "@/lib/signal-evidence/environment-session-hint";
import type { MarketEnvironmentPayload } from "@/lib/signal-evidence/market-environment-present";
import {
  buildScannerTerminalSections,
  DEFAULT_SCANNER_TERMINAL_FILTERS,
  isTickerSearchQuery,
  type ScannerTerminalFilters,
  type ScannerTerminalGapRow,
  type ScannerTerminalRadarGroup,
  type ScannerTerminalSelection,
  type ScannerTerminalSignalRow
} from "@/lib/scanner/terminal/scanner-terminal-model";
import { ScannerDetailPanel } from "@/components/scanner/terminal/scanner-detail-panel";

type Props = {
  overview: ScannerOverview;
  swingDesk: DeskTodayData | null;
  dayDesk: DeskTodayData | null;
  nearQualification: ScannerNearQualificationRow[];
  watchlistSymbols: string[];
  dayTradingSurfaces: boolean;
  evaluationTrace?: ScannerEvaluationTraceRow[];
  updatedLabel?: string | null;
};

function SectionHeader({
  title,
  count,
  open,
  onToggle,
  colors
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: spacing[2],
        padding: `${spacing[2]} 0`,
        border: "none",
        background: "transparent",
        cursor: "pointer",
        textAlign: "left"
      }}
    >
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: colors.textMuted }}>
        {title}
        {count > 0 ? ` (${count})` : ""}
      </span>
      <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>{open ? "−" : "+"}</span>
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
      onClick={onClick}
      style={{
        padding: `${spacing[1]} ${spacing[2]}`,
        borderRadius: 999,
        border: `1px solid ${active ? colors.accent : colors.border}`,
        background: active ? "rgba(46,139,255,.12)" : colors.surface,
        color: active ? colors.accent : colors.textMuted,
        fontSize: typography.scale.xs,
        fontWeight: active ? 700 : 500,
        cursor: "pointer"
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
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        width: "100%",
        textAlign: "left",
        padding: spacing[3],
        borderRadius: borderRadius.md,
        border: `1px solid ${selected ? colors.accent : colors.border}`,
        background: selected ? "rgba(46,139,255,.06)" : colors.surface,
        cursor: "pointer"
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: spacing[2] }}>
        <span style={{ fontWeight: 700, color: colors.text }}>{row.symbol}</span>
        <span style={{ color: pctTone, fontVariantNumeric: "tabular-nums" }}>
          {row.gapPct >= 0 ? "+" : ""}
          {row.gapPct.toFixed(1)}%
        </span>
      </div>
      <div style={{ marginTop: spacing[1], fontSize: typography.scale.xs, color: colors.textMuted }}>
        <span style={{ fontWeight: 600 }}>{row.statusLabel}</span>
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
  const laneAccent =
    row.lane === "day" ? roleAccents.dark.day.borderAccent : roleAccents.dark.swing.borderAccent;
  const biasColor = row.bias === "bull" ? colors.bullish : row.bias === "bear" ? colors.bearish : colors.textMuted;
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        width: "100%",
        textAlign: "left",
        padding: spacing[3],
        borderRadius: borderRadius.md,
        border: `1px solid ${selected ? colors.accent : colors.border}`,
        borderLeft: `3px solid ${laneAccent}`,
        background: highlight ? "rgba(34,197,94,.06)" : selected ? "rgba(46,139,255,.06)" : colors.surface,
        cursor: "pointer"
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: spacing[2] }}>
        <span style={{ fontWeight: 700, color: colors.text }}>{row.symbol}</span>
        <span style={{ fontSize: typography.scale.xs, color: colors.textMuted, fontVariantNumeric: "tabular-nums" }}>
          {row.price != null ? `$${row.price.toFixed(2)}` : ""}
          {row.changePct != null ? ` (${row.changePct >= 0 ? "+" : ""}${row.changePct.toFixed(1)}%)` : ""}
        </span>
      </div>
      <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, color: biasColor }}>
        {row.bias === "bull" ? "Bullish" : row.bias === "bear" ? "Bearish" : "Neutral"}
        {row.alignment ? ` · ${row.alignment.aligned}/${row.alignment.total} layers` : ""}
        {row.riskReward != null ? ` · R/R ${row.riskReward.toFixed(1)}:1` : ""}
      </p>
      {row.blockerNote && !highlight ? (
        <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted }}>{row.blockerNote}</p>
      ) : null}
      {highlight && row.verdict ? (
        <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted }}>{row.verdict}</p>
      ) : null}
      {sessionHint ? (
        <p style={{ margin: `${spacing[1]} 0 0`, fontSize: 10, color: colors.caution, fontWeight: 600 }}>{sessionHint}</p>
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
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        width: "100%",
        textAlign: "left",
        padding: spacing[3],
        borderRadius: borderRadius.md,
        border: `1px solid ${selected ? colors.accent : colors.border}`,
        background: colors.surfaceMuted ?? colors.surface,
        cursor: "pointer"
      }}
    >
      <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: colors.textMuted }}>
        {group.title}
      </p>
      <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, color: colors.text }}>
        {group.symbols.slice(0, 4).join(", ")}
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
  updatedLabel
}: Props) {
  const { colors } = useTheme();
  const environment = useMarketEnvironment("swing");
  const { data: macro } = useMacroContext();
  const [filters, setFilters] = useState<ScannerTerminalFilters>(DEFAULT_SCANNER_TERMINAL_FILTERS);
  const [selection, setSelection] = useState<ScannerTerminalSelection>(null);
  const [narrowLayout, setNarrowLayout] = useState(false);
  const [openSections, setOpenSections] = useState({
    gaps: true,
    actionable: true,
    developing: true,
    radar: true
  });

  const watchSet = useMemo(() => new Set(watchlistSymbols.map((s) => s.trim().toUpperCase())), [watchlistSymbols]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const apply = () => setNarrowLayout(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const sections = useMemo(
    () =>
      buildScannerTerminalSections({
        filters,
        gapIntelligence: overview.gapIntelligence,
        setups: overview.setups,
        swingDesk,
        dayDesk,
        nearQualification,
        dayTradingSurfaces,
        watchlistSymbols: watchSet
      }),
    [filters, overview, swingDesk, dayDesk, nearQualification, dayTradingSurfaces, watchSet]
  );

  const sessionOpen = isUsRegularSessionOpenEt(new Date());
  const regimeLabel =
    mapMacroRegimeToLabel(macro?.market_regime ?? overview.regimeLabel ?? "neutral") ??
    overview.regimeLabel ??
    "Neutral";
  const vixLine =
    environment?.vix_level != null
      ? `VIX ${environment.environment_tier === "normal" ? "calm" : environment.environment_tier} ${environment.vix_level.toFixed(1)}`
      : null;

  const feedStateForHint = (state: ScannerTerminalSignalRow["state"]) =>
    state === "actionable" ? "actionable" : state === "near" ? "near" : "potential";

  const sessionHintForRow = (row: ScannerTerminalSignalRow, env: MarketEnvironmentPayload | null) => {
    if (!env) return null;
    return environmentSessionCardHint(env, row.lane, feedStateForHint(row.state));
  };

  const allVisibleSymbols = useMemo(() => {
    const set = new Set<string>();
    for (const g of sections.gaps) set.add(g.symbol);
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
    minHeight: narrowLayout ? undefined : "calc(100vh - 4rem)"
  };

  const toggleSection = (key: keyof typeof openSections) =>
    setOpenSections((s) => ({ ...s, [key]: !s[key] }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[3], padding: spacing[4] }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: spacing[3],
          paddingBottom: spacing[2],
          borderBottom: `1px solid ${colors.border}`
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: spacing[2] }}>
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
          <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>
            {regimeLabel} market
            {vixLine ? ` · ${vixLine}` : ""}
            {overview.spyPct != null ? ` · SPY ${overview.spyPct >= 0 ? "+" : ""}${overview.spyPct.toFixed(1)}%` : ""}
            {` · ${sessionOpen ? "Active session" : "Outside RTH"}`}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: spacing[3] }}>
          {sections.actionableCount > 0 ? (
            <span
              style={{
                fontSize: typography.scale.xs,
                fontWeight: 700,
                color: colors.bullish,
                padding: `${spacing[1]} ${spacing[2]}`,
                borderRadius: 999,
                border: `1px solid rgba(34,197,94,.35)`,
                background: "rgba(34,197,94,.08)"
              }}
            >
              ✓ {sections.actionableCount} actionable
            </span>
          ) : null}
          {updatedLabel ? (
            <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>Updated {updatedLabel}</span>
          ) : null}
        </div>
      </div>

      {environment ? (
        <MarketEnvironmentStrip environment={environment} />
      ) : null}

      <input
        type="search"
        placeholder="Is a symbol in our radar? Search to find out…"
        value={filters.query}
        onChange={(e) => {
          setFilters((f) => ({ ...f, query: e.target.value }));
          if (!e.target.value.trim()) setSelection(null);
        }}
        style={{
          width: "100%",
          padding: `${spacing[2]} ${spacing[3]}`,
          borderRadius: borderRadius.md,
          border: `1px solid ${colors.border}`,
          background: colors.surface,
          color: colors.text,
          fontSize: typography.scale.sm
        }}
      />

      <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2] }}>
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
      </div>

      <div style={shellStyle}>
        <div style={{ display: "flex", flexDirection: "column", gap: spacing[4], minWidth: 0 }}>
          <section>
            <SectionHeader
              title="Gap intelligence — pre-market & opening hour"
              count={sections.gaps.length}
              open={openSections.gaps}
              onToggle={() => toggleSection("gaps")}
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

          <section>
            <SectionHeader
              title="Actionable now — all gates cleared"
              count={sections.actionable.length}
              open={openSections.actionable}
              onToggle={() => toggleSection("actionable")}
              colors={colors}
            />
            {openSections.actionable ? (
              <div style={{ display: "grid", gap: spacing[2] }}>
                {sections.actionable.length === 0 ? (
                  <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted }}>No actionable setups in this filter.</p>
                ) : (
                  sections.actionable.map((row) => (
                    <SignalRow
                      key={row.id}
                      row={row}
                      highlight
                      selected={selection?.kind === "signal" && selection.id === row.id}
                      onSelect={() => setSelection({ kind: "signal", id: row.id })}
                      sessionHint={sessionHintForRow(row, environment)}
                      colors={colors}
                    />
                  ))
                )}
              </div>
            ) : null}
          </section>

          <section>
            <SectionHeader
              title="Developing — building toward actionable"
              count={sections.developing.length}
              open={openSections.developing}
              onToggle={() => toggleSection("developing")}
              colors={colors}
            />
            {openSections.developing ? (
              <div style={{ display: "grid", gap: spacing[2] }}>
                {sections.developing.length === 0 ? (
                  <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted }}>No developing setups in this filter.</p>
                ) : (
                  <>
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
                  </>
                )}
              </div>
            ) : null}
          </section>

          <section>
            <SectionHeader
              title="On radar — active themes today"
              count={sections.radar.reduce((n, g) => n + g.symbols.length, 0)}
              open={openSections.radar}
              onToggle={() => toggleSection("radar")}
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

        <aside
          style={{
            position: narrowLayout ? "static" : "sticky",
            top: spacing[4],
            alignSelf: "start",
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.lg,
            background: colors.surface,
            minHeight: 280
          }}
        >
          <ScannerDetailPanel
            selection={selection}
            gaps={sections.gaps}
            actionable={sections.actionable}
            developing={sections.developing}
            radar={sections.radar}
            environment={environment}
            evaluationTrace={evaluationTrace}
            colors={colors}
          />
        </aside>
      </div>
    </div>
  );
}

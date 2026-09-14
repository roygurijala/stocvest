"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type CSSProperties } from "react";

import { SignalDisclaimerChip } from "@/components/signal-disclaimer-chip";
import { PositionCompareTable } from "@/components/invest/position-compare-table";
import { borderRadius, roleAccents, spacing, typography } from "@/lib/design-system";
import {
  applyPositionGemFilter,
  buildPositionCompareMatrix,
  buildPositionGemDisplayRows,
  buildPositionGemRowDetail,
  DEFAULT_POSITION_GEM_FILTER,
  emptyPositionGemCopy,
  formatGemListDelta,
  isPositionScanUnavailable,
  POSITION_COMPARE_MAX,
  positionActionColor,
  positionGemTierCopy,
  togglePositionCompareSelection,
  type PositionGemDisplayRow,
  type PositionGemFilter,
  type PositionGemRowDetail,
  type PositionGemTierFilter
} from "@/lib/dashboard/position-ranked-home-present";
import { usePositionCandidates } from "@/lib/hooks/use-position-candidates";
import { dashboardTradingRoomHref } from "@/lib/nav/dashboard-trading-room-deeplink";
import { useTheme } from "@/lib/theme-provider";

const TIER_TABS: { id: PositionGemTierFilter; label: string }[] = [
  { id: "all", label: "Hunt" },
  { id: "gem", label: "Gem candidates" },
  { id: "strong", label: "Strong quality" },
  { id: "monitor", label: "Monitor" }
];

function scoreLabel(score: number | null): string {
  return score != null ? `${score}` : "—";
}

export function InvestPageClient() {
  const { theme, colors } = useTheme();
  const accent = roleAccents[theme].position;
  const router = useRouter();

  const [filter, setFilter] = useState<PositionGemFilter>(DEFAULT_POSITION_GEM_FILTER);
  const [searchInput, setSearchInput] = useState("");
  const [compareSelected, setCompareSelected] = useState<string[]>([]);
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);

  const { response, isInitialLoading, isPending, error, timedOut, refresh } = usePositionCandidates(
    "all",
    {
      limit: 100
    }
  );

  const rows: PositionGemDisplayRow[] = useMemo(() => {
    if (!response) return [];
    const filtered = applyPositionGemFilter(response.candidates, filter);
    return buildPositionGemDisplayRows(filtered);
  }, [response, filter]);

  // PERSONAL-MODE: show the Buy / Watch / Don't-buy column only when the backend attaches an
  // action (personal-mode flag on). In product mode no row carries one, so the column hides.
  const showAction = useMemo(() => rows.some((r) => !!r.actionLabel), [rows]);

  const compareMatrix = useMemo(
    () => buildPositionCompareMatrix(response?.candidates, compareSelected),
    [response?.candidates, compareSelected]
  );

  function toggleCompare(symbol: string) {
    setCompareSelected((prev) => togglePositionCompareSelection(prev, symbol));
  }

  function toggleExpanded(symbol: string) {
    setExpandedSymbol((prev) => (prev === symbol ? null : symbol));
  }

  const scanLabel = useMemo(() => {
    if (!response?.scanGeneratedAt) return null;
    const d = new Date(response.scanGeneratedAt);
    return Number.isNaN(d.getTime()) ? null : d.toLocaleString();
  }, [response?.scanGeneratedAt]);

  const deltaLabel = useMemo(() => formatGemListDelta(response?.listDelta), [response?.listDelta]);

  function submitSymbolSearch(e: React.FormEvent) {
    e.preventDefault();
    const sym = searchInput.trim().toUpperCase();
    if (!sym) return;
    router.push(dashboardTradingRoomHref(sym, "position", { ref: "invest-search" }));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[5], padding: spacing[4] }}>
      {/* Header */}
      <header
        data-testid="invest-header"
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: spacing[3],
          borderLeft: `3px solid ${accent.borderAccent}`,
          paddingLeft: spacing[3]
        }}
      >
        <div>
          <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: "1.4px", textTransform: "uppercase", color: accent.accent }}>
            Investment · growth discovery
          </p>
          <h1 style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xl, fontWeight: 700, color: colors.text }}>
            Gem Candidates
          </h1>
          <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted }}>
            Hunt home is gems only, top 15. Mega-caps live on Strong quality and Monitor. News/geo is a catalyst, not the badge. Informational only, never a recommendation.
            {scanLabel ? ` Last scan: ${scanLabel}.` : ""}
          </p>
          {deltaLabel ? (
            <p data-testid="invest-list-delta" style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted }}>
              {deltaLabel}
            </p>
          ) : null}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2], alignItems: "center" }}>
          <button
            type="button"
            data-testid="invest-refresh"
            aria-label="Refresh investment scan"
            onClick={() => refresh()}
            disabled={isPending || isInitialLoading}
            style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.md,
              color: colors.text,
              fontSize: typography.scale.sm,
              fontWeight: 600,
              padding: `${spacing[2]} ${spacing[3]}`,
              cursor: isPending || isInitialLoading ? "wait" : "pointer"
            }}
          >
            {isPending || isInitialLoading ? "Scanning…" : "Refresh"}
          </button>
          <form onSubmit={submitSymbolSearch} style={{ display: "flex", gap: spacing[2] }} role="search">
            <input
              aria-label="Look up a symbol for the Long Term desk"
              placeholder="Look up any symbol…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              style={{
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: borderRadius.md,
                color: colors.text,
                fontSize: typography.scale.sm,
                padding: `${spacing[2]} ${spacing[3]}`,
                minWidth: 160
              }}
            />
            <button
              type="submit"
              style={{
                background: accent.accent,
                border: "none",
                borderRadius: borderRadius.md,
                color: "#0b0b0f",
                fontSize: typography.scale.sm,
                fontWeight: 700,
                padding: `${spacing[2]} ${spacing[3]}`,
                cursor: "pointer"
              }}
            >
              Look up
            </button>
          </form>
        </div>
      </header>

      {/* Tier tabs + filters */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2], alignItems: "center" }}>
        {TIER_TABS.map((tab) => {
          const active = filter.tier === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              data-testid={`invest-tier-${tab.id}`}
              aria-pressed={active}
              onClick={() => {
                if (tab.id === filter.tier) return;
                // Reset compare on a tier switch so selections can't linger invisibly
                // (a name may not exist in the new tier's screen). Filter/slider changes
                // deliberately keep the selection.
                setCompareSelected([]);
                setExpandedSymbol(null);
                setFilter((f) => ({ ...f, tier: tab.id }));
              }}
              style={{
                background: active ? accent.accent : colors.surface,
                border: `1px solid ${active ? accent.borderAccent : colors.border}`,
                borderRadius: borderRadius.full,
                color: active ? "#0b0b0f" : colors.textMuted,
                fontSize: typography.scale.xs,
                fontWeight: 600,
                padding: `${spacing[1]} ${spacing[3]}`,
                cursor: "pointer"
              }}
            >
              {tab.label}
            </button>
          );
        })}
        <label style={{ display: "flex", alignItems: "center", gap: spacing[1], fontSize: typography.scale.xs, color: colors.textMuted }}>
          Min fundamentals
          <input
            aria-label="Minimum fundamentals score"
            type="number"
            min={0}
            max={100}
            value={filter.minFundamentals ?? ""}
            onChange={(e) =>
              setFilter((f) => ({
                ...f,
                minFundamentals: e.target.value === "" ? null : Number(e.target.value)
              }))
            }
            style={{
              width: 64,
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.sm,
              color: colors.text,
              padding: spacing[1]
            }}
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: spacing[1], fontSize: typography.scale.xs, color: colors.textMuted }}>
          Min trend
          <input
            aria-label="Minimum technical trend score"
            type="number"
            min={0}
            max={100}
            value={filter.minTechnical ?? ""}
            onChange={(e) =>
              setFilter((f) => ({
                ...f,
                minTechnical: e.target.value === "" ? null : Number(e.target.value)
              }))
            }
            style={{
              width: 64,
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.sm,
              color: colors.text,
              padding: spacing[1]
            }}
          />
        </label>
      </div>

      {/* POS-AI-6 — deterministic 2–4 name compare (renders only when ≥2 selected) */}
      <PositionCompareTable
        matrix={compareMatrix}
        colors={colors}
        accentColor={accent.accent}
        onRemove={(sym) => toggleCompare(sym)}
        onClear={() => setCompareSelected([])}
      />

      {/* Table */}
      {isPositionScanUnavailable(response, error) ? (
        <p data-testid="invest-error" style={{ margin: 0, fontSize: typography.scale.sm, color: colors.caution }}>
          The investment scan is temporarily unavailable. Try Refresh, or wait a moment.
        </p>
      ) : isInitialLoading || isPending ? (
        <p data-testid="invest-loading" style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted }}>
          {timedOut
            ? "Still scanning the universe — this can take a couple of minutes."
            : "Scanning the universe…"}
        </p>
      ) : rows.length === 0 ? (
        <p data-testid="invest-empty" style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted, lineHeight: 1.5 }}>
          {emptyPositionGemCopy(filter, response?.candidates ?? [], response?.universeSize ?? 0)}
        </p>
      ) : (
        <div data-testid="invest-gem-table" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: typography.scale.sm }}>
            <thead>
              <tr style={{ textAlign: "left", color: colors.textMuted, fontSize: typography.scale.xs }}>
                <th style={{ padding: spacing[2] }}>Compare</th>
                <th style={{ padding: spacing[2] }}>Symbol</th>
                <th style={{ padding: spacing[2] }}>Quality</th>
                {showAction ? <th style={{ padding: spacing[2] }}>Action</th> : null}
                <th style={{ padding: spacing[2] }}>Fundamentals</th>
                <th style={{ padding: spacing[2] }}>Trend</th>
                <th style={{ padding: spacing[2] }}>Sector</th>
                <th style={{ padding: spacing[2] }}>Weakest pillar</th>
                <th style={{ padding: spacing[2] }}>Why</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const open = expandedSymbol === row.symbol;
                const colSpan = showAction ? 9 : 8;
                return (
                  <InvestGemTableRows
                    key={row.symbol}
                    row={row}
                    open={open}
                    colSpan={colSpan}
                    showAction={showAction}
                    compareChecked={compareSelected.includes(row.symbol)}
                    compareDisabled={
                      !compareSelected.includes(row.symbol) &&
                      compareSelected.length >= POSITION_COMPARE_MAX
                    }
                    onToggleCompare={() => toggleCompare(row.symbol)}
                    onToggleExpand={() => toggleExpanded(row.symbol)}
                    accentColor={accent.accent}
                    colors={colors}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.5 }}>
        {positionGemTierCopy("gem")} Row click expands why this name is on the board. The ticker opens the Long Term deep dive. Energy and other cycle names stay on the list — Gem is a trailing-print screen, not a hold-through-a-war call.
      </p>
      <SignalDisclaimerChip />
    </div>
  );
}

type InvestRowColors = {
  text: string;
  textMuted: string;
  caution: string;
  border: string;
  surface: string;
  bullish: string;
  bearish: string;
};

function InvestGemTableRows({
  row,
  open,
  colSpan,
  showAction,
  compareChecked,
  compareDisabled,
  onToggleCompare,
  onToggleExpand,
  accentColor,
  colors
}: {
  row: PositionGemDisplayRow;
  open: boolean;
  colSpan: number;
  showAction: boolean;
  compareChecked: boolean;
  compareDisabled: boolean;
  onToggleCompare: () => void;
  onToggleExpand: () => void;
  accentColor: string;
  colors: InvestRowColors;
}) {
  const detail = open ? buildPositionGemRowDetail(row) : null;
  return (
    <>
      <tr
        data-testid={`invest-row-${row.symbol}`}
        aria-expanded={open}
        onClick={onToggleExpand}
        style={{ borderTop: `1px solid ${colors.border}`, cursor: "pointer" }}
      >
        <td style={{ padding: spacing[2] }} onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            aria-label={`Add ${row.symbol} to compare`}
            data-testid={`invest-compare-${row.symbol}`}
            checked={compareChecked}
            disabled={compareDisabled}
            onChange={onToggleCompare}
          />
        </td>
        <td style={{ padding: spacing[2], fontWeight: 700 }} onClick={(e) => e.stopPropagation()}>
          <Link href={row.href} style={{ color: accentColor, textDecoration: "none" }}>
            {row.symbol}
          </Link>
        </td>
        <td style={{ padding: spacing[2] }} title={row.tierCopy}>
          {row.tierLabel}
          {row.catalyst ? (
            <span style={{ marginLeft: spacing[1], color: colors.textMuted, fontWeight: 500 }}>
              · Catalyst
            </span>
          ) : null}
        </td>
        {showAction ? (
          <td
            style={{ padding: spacing[2], fontWeight: 700, color: positionActionColor(row.action, colors) }}
            data-testid={`invest-action-${row.symbol}`}
          >
            {row.actionLabel ?? "—"}
          </td>
        ) : null}
        <td style={{ padding: spacing[2], color: colors.text }}>
          {scoreLabel(row.fundamentalsScore)} · {row.fundamentalsLabel}
        </td>
        <td style={{ padding: spacing[2], color: colors.text }}>
          {scoreLabel(row.technicalScore)} · {row.trendLabel}
        </td>
        <td style={{ padding: spacing[2], color: colors.textMuted }}>{row.sectorLabel}</td>
        <td style={{ padding: spacing[2], color: colors.caution }}>{row.weakestLabel}</td>
        <td style={{ padding: spacing[2], color: colors.textMuted, maxWidth: 320 }}>
          <span>{row.why}</span>
          <span aria-hidden="true" style={{ marginLeft: spacing[1] }}>
            {open ? "▾" : "▸"}
          </span>
        </td>
      </tr>
      {detail ? (
        <tr data-testid={`invest-row-detail-${row.symbol}`}>
          <td colSpan={colSpan} style={{ padding: `${spacing[2]} ${spacing[3]} ${spacing[3]}`, background: colors.surface }}>
            <GemRowDetailPanel detail={detail} accentColor={accentColor} colors={colors} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function GemRowDetailPanel({
  detail,
  accentColor,
  colors
}: {
  detail: PositionGemRowDetail;
  accentColor: string;
  colors: InvestRowColors;
}) {
  const muted: CSSProperties = {
    margin: 0,
    fontSize: typography.scale.xs,
    color: colors.textMuted,
    lineHeight: 1.5
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}>
      <p data-testid="invest-detail-why" style={{ ...muted, color: colors.text }}>
        {detail.why}
      </p>
      <p data-testid="invest-detail-membership" style={muted}>
        {detail.membership}
      </p>
      <p data-testid="invest-detail-f2-window" style={muted}>
        {detail.f2WindowCaveat}
      </p>
      {detail.sectorCycleNote ? (
        <p data-testid="invest-detail-sector-cycle" style={muted}>
          {detail.sectorCycleNote}
        </p>
      ) : null}
      {detail.catalystNote ? (
        <p data-testid="invest-detail-catalyst" style={muted}>
          {detail.catalystNote}
        </p>
      ) : null}
      <p data-testid="invest-detail-value-trap" style={muted}>
        {detail.valueTrapNote}
      </p>
      {detail.pillars.length > 0 ? (
        <p data-testid="invest-detail-pillars" style={muted}>
          Pillars:{" "}
          {detail.pillars
            .map((p) => `${p.pillarId} ${p.label} ${p.scoreLabel} ${p.verdictLabel}`)
            .join(" · ")}
        </p>
      ) : null}
      {detail.failingGates.length > 0 ? (
        <p data-testid="invest-detail-gates" style={muted}>
          Gates missed: {detail.failingGates.join(", ")}
        </p>
      ) : null}
      <Link
        href={detail.href}
        data-testid="invest-detail-deep-dive"
        style={{ color: accentColor, fontSize: typography.scale.xs, fontWeight: 600, textDecoration: "none" }}
      >
        {detail.deepDiveLabel}
      </Link>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { SignalDisclaimerChip } from "@/components/signal-disclaimer-chip";
import { PositionCompareTable } from "@/components/invest/position-compare-table";
import { borderRadius, roleAccents, spacing, typography } from "@/lib/design-system";
import {
  applyPositionGemFilter,
  buildPositionCompareMatrix,
  buildPositionGemDisplayRows,
  DEFAULT_POSITION_GEM_FILTER,
  POSITION_COMPARE_MAX,
  positionGemTierCopy,
  togglePositionCompareSelection,
  type PositionGemDisplayRow,
  type PositionGemFilter,
  type PositionGemTierFilter
} from "@/lib/dashboard/position-ranked-home-present";
import { usePositionCandidates } from "@/lib/hooks/use-position-candidates";
import { dashboardTradingRoomHref } from "@/lib/nav/dashboard-trading-room-deeplink";
import { useTheme } from "@/lib/theme-provider";

const TIER_TABS: { id: PositionGemTierFilter; label: string }[] = [
  { id: "gem", label: "Gem candidates" },
  { id: "strong", label: "Strong quality" },
  { id: "monitor", label: "Monitor" },
  { id: "all", label: "All" }
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

  const { response, isInitialLoading, error } = usePositionCandidates(filter.tier);

  const rows: PositionGemDisplayRow[] = useMemo(() => {
    if (!response) return [];
    const filtered = applyPositionGemFilter(response.candidates, filter);
    return buildPositionGemDisplayRows(filtered);
  }, [response, filter]);

  const compareMatrix = useMemo(
    () => buildPositionCompareMatrix(response?.candidates, compareSelected),
    [response?.candidates, compareSelected]
  );

  function toggleCompare(symbol: string) {
    setCompareSelected((prev) => togglePositionCompareSelection(prev, symbol));
  }

  const scanLabel = useMemo(() => {
    if (!response?.scanGeneratedAt) return null;
    const d = new Date(response.scanGeneratedAt);
    return Number.isNaN(d.getTime()) ? null : d.toLocaleString();
  }, [response?.scanGeneratedAt]);

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
            Investment · long-horizon quality
          </p>
          <h1 style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xl, fontWeight: 700, color: colors.text }}>
            Gem Candidates
          </h1>
          <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted }}>
            Transparent pillar screen — informational only, never a recommendation.
            {scanLabel ? ` Last scan: ${scanLabel}.` : ""}
          </p>
        </div>
        <form onSubmit={submitSymbolSearch} style={{ display: "flex", gap: spacing[2] }} role="search">
          <input
            aria-label="Look up a symbol for the Position desk"
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
              onClick={() => setFilter((f) => ({ ...f, tier: tab.id }))}
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
      {error ? (
        <p data-testid="invest-error" style={{ margin: 0, fontSize: typography.scale.sm, color: colors.caution }}>
          The investment scan is temporarily unavailable. Try again in a moment.
        </p>
      ) : isInitialLoading ? (
        <p data-testid="invest-loading" style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted }}>
          Scanning the universe…
        </p>
      ) : rows.length === 0 ? (
        <p data-testid="invest-empty" style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted, lineHeight: 1.5 }}>
          No names passed these gates — widen filters or run a symbol lookup above.
        </p>
      ) : (
        <div data-testid="invest-gem-table" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: typography.scale.sm }}>
            <thead>
              <tr style={{ textAlign: "left", color: colors.textMuted, fontSize: typography.scale.xs }}>
                <th style={{ padding: spacing[2] }}>Compare</th>
                <th style={{ padding: spacing[2] }}>Symbol</th>
                <th style={{ padding: spacing[2] }}>Quality</th>
                <th style={{ padding: spacing[2] }}>Fundamentals</th>
                <th style={{ padding: spacing[2] }}>Trend</th>
                <th style={{ padding: spacing[2] }}>Sector</th>
                <th style={{ padding: spacing[2] }}>Weakest pillar</th>
                <th style={{ padding: spacing[2] }}>Why</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.symbol}
                  data-testid={`invest-row-${row.symbol}`}
                  style={{ borderTop: `1px solid ${colors.border}` }}
                >
                  <td style={{ padding: spacing[2] }}>
                    <input
                      type="checkbox"
                      aria-label={`Add ${row.symbol} to compare`}
                      data-testid={`invest-compare-${row.symbol}`}
                      checked={compareSelected.includes(row.symbol)}
                      disabled={
                        !compareSelected.includes(row.symbol) &&
                        compareSelected.length >= POSITION_COMPARE_MAX
                      }
                      onChange={() => toggleCompare(row.symbol)}
                    />
                  </td>
                  <td style={{ padding: spacing[2], fontWeight: 700 }}>
                    <Link href={row.href} style={{ color: accent.accent, textDecoration: "none" }}>
                      {row.symbol}
                    </Link>
                  </td>
                  <td style={{ padding: spacing[2] }} title={row.tierCopy}>
                    {row.tierLabel}
                  </td>
                  <td style={{ padding: spacing[2], color: colors.text }}>
                    {scoreLabel(row.fundamentalsScore)} · {row.fundamentalsLabel}
                  </td>
                  <td style={{ padding: spacing[2], color: colors.text }}>
                    {scoreLabel(row.technicalScore)} · {row.trendLabel}
                  </td>
                  <td style={{ padding: spacing[2], color: colors.textMuted }}>{row.sectorLabel}</td>
                  <td style={{ padding: spacing[2], color: colors.caution }}>{row.weakestLabel}</td>
                  <td style={{ padding: spacing[2], color: colors.textMuted, maxWidth: 320 }}>{row.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.5 }}>
        {positionGemTierCopy("gem")} Row click opens the full Position deep dive (pillars, geometry, evidence).
      </p>
      <SignalDisclaimerChip />
    </div>
  );
}

"use client";

/**
 * ADR-004 POS-D8 — optional compact "Gem candidates" strip for the Trading Room feed
 * column. Reads the POS-D15 position candidates screen (gem/strong only) and renders a
 * small teaser row that links to `/dashboard/invest` (Journey A) and to each name's
 * Position deep-dive tab (Journey B). Position cards are deliberately kept OUT of the
 * swing/day feed — this is a visually distinct strip, never a feed card.
 *
 * Ships dark: renders nothing unless `positionFeedEnabled()` is on. It also renders
 * nothing while the screen is loading with no data, on error, or when there are no
 * gem/strong names — so a cold cache never leaves a broken/empty strip on the desk.
 */
import Link from "next/link";
import { useMemo } from "react";

import { useTheme } from "@/lib/theme-provider";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { positionFeedEnabled } from "@/lib/nav-features";
import { usePositionCandidates } from "@/lib/hooks/use-position-candidates";
import { buildPositionGemRailItems, positionActionColor } from "@/lib/dashboard/position-ranked-home-present";
import { watchlistQualityDotColor } from "@/lib/dashboard/trading-room/watchlist-rail-present";

const INVEST_HREF = "/dashboard/invest";
const MAX_ITEMS = 6;
// Match the watchlist rail's `usePositionCandidates("all", { limit: 100 })` so both
// share one SWR key and dedupe into a single fetch when both flags are on.
const SCAN_LIMIT = 100;

export function PositionGemRail() {
  const enabled = positionFeedEnabled();
  const { colors } = useTheme();
  // `enabled` gates the SWR key inside the hook, so this network call is a no-op when the
  // flag is off (dark ship). Pull the whole screen and let the presenter pick gem/strong.
  const { response } = usePositionCandidates("all", { limit: SCAN_LIMIT, enabled });
  const items = useMemo(
    () => buildPositionGemRailItems(response?.candidates ?? null, MAX_ITEMS),
    [response?.candidates]
  );

  if (!enabled || items.length === 0) return null;

  return (
    <section
      data-testid="trading-room-position-gem-rail"
      aria-label="Gem candidates"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: spacing[2],
        padding: spacing[3],
        borderRadius: borderRadius.lg,
        border: `1px solid ${colors.border}`,
        background: colors.surface
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing[2] }}>
        <span
          style={{
            fontSize: 10.5,
            color: colors.textMuted,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            fontWeight: 600
          }}
        >
          Gem candidates
        </span>
        <Link
          href={INVEST_HREF}
          data-testid="trading-room-position-gem-rail-viewall"
          style={{
            fontSize: typography.scale.xs,
            fontWeight: 600,
            color: colors.accent,
            textDecoration: "none",
            whiteSpace: "nowrap"
          }}
        >
          View all →
        </Link>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2] }}>
        {items.map((item) => {
          const dot = watchlistQualityDotColor(item.tier, colors);
          const actionColor = positionActionColor(item.action, colors);
          const tooltip = item.weakestLabel
            ? `${item.tierShort} — weakest pillar: ${item.weakestLabel}`
            : item.tierShort;
          return (
            <Link
              key={item.symbol}
              href={item.href}
              title={tooltip}
              data-testid={`trading-room-position-gem-chip-${item.symbol}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                border: `1px solid ${colors.border}`,
                background: colors.surfaceMuted,
                color: colors.text,
                borderRadius: borderRadius.full,
                padding: "4px 10px",
                fontSize: typography.scale.xs,
                fontWeight: 700,
                textDecoration: "none",
                whiteSpace: "nowrap"
              }}
            >
              {/* Decorative — the tier is already announced by the visible text label below. */}
              <span
                aria-hidden
                style={{ width: 7, height: 7, borderRadius: "50%", background: dot, flex: "none" }}
              />
              {item.symbol}
              <span style={{ color: colors.textMuted, fontWeight: 600 }}>{item.tierShort}</span>
              {/* PERSONAL-MODE: explicit Buy / Watch / Don't-buy stance (personal-mode only). */}
              {item.actionLabel ? (
                <span
                  data-testid={`trading-room-position-gem-action-${item.symbol}`}
                  style={{ color: actionColor, fontWeight: 800 }}
                >
                  {item.actionLabel}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

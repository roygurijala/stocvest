"use client";

/**
 * Dashboard Active Signal Ribbon — Phase C of the dashboard redesign.
 *
 * A slim horizontal ribbon that sits ABOVE the two-desk grid and
 * surfaces the top 3–6 currently-firing signals across BOTH modes
 * as scrollable chips. Each chip carries:
 *   - The symbol
 *   - A mode tag ("SWING" or "DAY") so users don't have to translate
 *   - The direction in colour
 *   - A click target that jumps to the Signals page with `symbol` and
 *     `trading_mode` deep-linked
 *
 * STRUCTURAL GUARANTEES (must hold across edits):
 *   1. The ribbon is NOT a master card — no `data-card-role` attribute.
 *   2. The ribbon NEVER ranks across modes. Within-mode scoring is
 *      preserved; we deliberately interleave swing and day so users
 *      see "both engines firing" rather than a cross-mode podium.
 *      A cross-mode score would violate Mode Separation discipline.
 *   3. The empty state is a calm, dignified "watching N tickers" line
 *      with a clear path forward (link to Scanner). Never a sad-face
 *      or apology.
 *   4. Mobile-first: chips scroll horizontally on narrow viewports
 *      with momentum; on `lg+` they fit inline with a thin scroll-bar
 *      hidden under hover.
 *
 * Mode Separation guard: the ribbon takes RAW per-mode signal arrays
 * as separate props. It does not merge them into a single sorted
 * list internally. Reading flow inside the ribbon is "swing chip ·
 * day chip · swing chip · day chip", interleaved, so neither mode
 * gets visually demoted.
 */

import Link from "next/link";
import { useMemo } from "react";
import { ArrowRight } from "lucide-react";
import type { IntradaySetupPayload } from "@/lib/api/scanner";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { interactionLevelProps } from "@/lib/dashboard/click-hierarchy";
import { useHoverPrefetch } from "@/lib/hooks/use-hover-prefetch";
import { useTheme } from "@/lib/theme-provider";

export interface DashboardActiveSignalRibbonProps {
  /** Swing setups, already filtered to `scanner_mode === "swing_daily"` and sorted desc by score. */
  swingSignals: IntradaySetupPayload[];
  /** Intraday setups, already filtered to NOT-swing and sorted desc by score. */
  daySignals: IntradaySetupPayload[];
  /** When the universe was empty / scanner errored, an empty-ish summary string. */
  emptyContext?: {
    swingUniverseSymbolCount?: number | null;
    gapIntelligenceSnapshotSymbolCount?: number | null;
    scannerError?: string;
  };
  /** When false (Swing Pro), copy and labels describe the swing engine only — no day desk. */
  dualDeskSurfaces?: boolean;
}

type RibbonChip = {
  symbol: string;
  mode: "swing" | "day";
  direction: "bullish" | "bearish" | "neutral";
  score: number | null;
};

function normalizeDirection(d: string | null | undefined): "bullish" | "bearish" | "neutral" {
  const v = (d || "").toLowerCase();
  if (v.includes("bull") || v === "long") return "bullish";
  if (v.includes("bear") || v === "short") return "bearish";
  return "neutral";
}

function buildChip(s: IntradaySetupPayload, mode: "swing" | "day"): RibbonChip {
  return {
    symbol: s.symbol,
    mode,
    direction: normalizeDirection(s.direction),
    score: typeof s.score === "number" && Number.isFinite(s.score) ? s.score : null
  };
}

/**
 * Interleave swing + day chips so the ribbon reads "S D S D S D" when
 * both desks have plenty, and just "S S S" or "D D D" when only one
 * is firing. This deliberately produces equal visual presence across
 * the two modes — never a leaderboard.
 */
function interleave(swing: RibbonChip[], day: RibbonChip[]): RibbonChip[] {
  const out: RibbonChip[] = [];
  const maxLen = Math.max(swing.length, day.length);
  for (let i = 0; i < maxLen; i += 1) {
    if (i < swing.length) out.push(swing[i]!);
    if (i < day.length) out.push(day[i]!);
  }
  return out;
}

/**
 * Per-chip sub-component. Extracted so each chip can call
 * `useHoverPrefetch(href)` independently — calling hooks inside
 * `chips.map((c) => useHoverPrefetch(...))` would violate the
 * Rules of Hooks. The chip is otherwise a 1:1 inline render of
 * the previous body.
 *
 * Tier 1 → Layer 4: each chip warms the Signals route on hover /
 * focus / pointer-down, so by the time the user clicks the RSC
 * payload is already fetching or cached. Mount-time prefetch
 * stays disabled (`prefetch={false}`) — Tier 1.A invariant.
 */
function RibbonChip({
  chip,
  colors
}: {
  chip: RibbonChip;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const symbol = chip.symbol.trim().toUpperCase();
  const href = `/dashboard/signals?symbol=${encodeURIComponent(symbol)}&ref=dashboard-ribbon&trading_mode=${chip.mode}`;
  const hoverHandlers = useHoverPrefetch(href);
  const dirColor =
    chip.direction === "bullish"
      ? colors.bullish
      : chip.direction === "bearish"
        ? colors.bearish
        : colors.textMuted;
  const dirBg =
    chip.direction === "bullish"
      ? "rgba(34,197,94,0.10)"
      : chip.direction === "bearish"
        ? "rgba(239,68,68,0.10)"
        : "rgba(148,163,184,0.08)";
  const dirBorder =
    chip.direction === "bullish"
      ? "rgba(34,197,94,0.36)"
      : chip.direction === "bearish"
        ? "rgba(239,68,68,0.36)"
        : "rgba(148,163,184,0.28)";
  const modeColor = chip.mode === "swing" ? "#a855f7" : "#00C8DC";
  return (
    // Perf invariant — see docs/PERFORMANCE.md §3.1 + §4.
    // Ribbon chips are an N-of-N container: every chip the
    // dashboard renders points at the heaviest SSR page in
    // the app (`/dashboard/signals`). Next.js's default
    // `prefetch="auto"` would fire one full SSR prefetch
    // per visible chip on mount, draining the same
    // connection that's serving the dashboard's own data.
    // That's the 16.78s "Content Download" the user
    // captured on 2026-05-13. `prefetch={false}` disables
    // the speculative fetch without affecting navigation —
    // clicking a chip still routes normally. Layer 4 adds
    // `useHoverPrefetch` so the prefetch fires on intent
    // (hover / focus / pointer-down) instead of on mount.
    <Link
      data-testid={`ribbon-chip-${symbol}`}
      data-ribbon-chip-mode={chip.mode}
      data-hover-prefetch="true"
      {...interactionLevelProps("deep")}
      prefetch={false}
      href={href}
      onMouseEnter={hoverHandlers.onMouseEnter}
      onFocus={hoverHandlers.onFocus}
      onPointerDown={hoverHandlers.onPointerDown}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: spacing[1],
        flexShrink: 0,
        padding: "4px 10px 4px 8px",
        borderRadius: borderRadius.full,
        background: dirBg,
        border: `1px solid ${dirBorder}`,
        color: dirColor,
        fontSize: typography.scale.xs,
        fontWeight: 700,
        textDecoration: "none",
        lineHeight: 1
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: modeColor,
          display: "inline-block",
          marginRight: 4
        }}
      />
      <span style={{ letterSpacing: "0.04em" }}>{symbol}</span>
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: modeColor,
          marginLeft: 2
        }}
      >
        {chip.mode}
      </span>
      {typeof chip.score === "number" ? (
        <span
          style={{
            fontSize: typography.scale.xs,
            fontWeight: 700,
            color: colors.text,
            marginLeft: 4,
            fontVariantNumeric: "tabular-nums"
          }}
        >
          {Math.round(chip.score * 100)}%
        </span>
      ) : null}
    </Link>
  );
}

export function DashboardActiveSignalRibbon({
  swingSignals,
  daySignals,
  emptyContext,
  dualDeskSurfaces = true
}: DashboardActiveSignalRibbonProps) {
  const { colors } = useTheme();
  const emptyScannerHover = useHoverPrefetch("/dashboard/scanner");

  // Cap each mode at 4 chips before interleaving. This bounds the total
  // ribbon contents to ≤ 8 chips on wide viewports, which keeps the
  // strip glanceable. Anything below 8 fits without horizontal scroll
  // at typical desktop widths (~1280px+).
  const chips: RibbonChip[] = useMemo(() => {
    const s = swingSignals.slice(0, 4).map((x) => buildChip(x, "swing"));
    const d = daySignals.slice(0, 4).map((x) => buildChip(x, "day"));
    return interleave(s, d);
  }, [swingSignals, daySignals]);

  const totalChips = chips.length;

  // ── Empty state ─────────────────────────────────────────────────────────
  if (totalChips === 0) {
    const universeN =
      typeof emptyContext?.gapIntelligenceSnapshotSymbolCount === "number" &&
      emptyContext.gapIntelligenceSnapshotSymbolCount > 0
        ? emptyContext.gapIntelligenceSnapshotSymbolCount
        : emptyContext?.swingUniverseSymbolCount;
    const watchingLine =
      typeof universeN === "number" && universeN > 0
        ? dualDeskSurfaces
          ? `Watching ${universeN.toLocaleString()} tickers across both desks. No firing signals at the moment — both engines are still scanning.`
          : `Watching ${universeN.toLocaleString()} swing-universe tickers. No firing swing setups at the moment — the swing engine is still scanning.`
        : dualDeskSurfaces
          ? "No firing signals at the moment — both engines are still scanning. The ribbon will populate as setups come through."
          : "No firing swing setups at the moment — the swing engine is still scanning. The ribbon will populate as setups come through.";
    return (
      <section
        data-testid="dashboard-active-signal-ribbon"
        data-ribbon-state="empty"
        aria-label="Active signal ribbon — currently empty"
        className={surfaceGlowClassName}
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: spacing[3],
          padding: `${spacing[3]} ${spacing[4]}`,
          borderRadius: borderRadius.lg,
          border: `1px dashed color-mix(in srgb, ${colors.border} 80%, transparent)`,
          background: "rgba(148,163,184,0.04)"
        }}
      >
        <div
          aria-hidden
          className="stocvest-pulse-dot"
          style={{ background: colors.textMuted }}
        />
        <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.text, flex: "1 1 auto", lineHeight: 1.5 }}>
          {emptyContext?.scannerError ? emptyContext.scannerError : watchingLine}
        </p>
        {/* Perf invariant — see docs/PERFORMANCE.md §3.1 + §4C.
            The ribbon empty-state CTA points at `/dashboard/scanner`,
            which is one of the heavy SSR targets we never
            speculatively prefetch from the dashboard. Layer 4 adds
            hover-prefetch so the route warms when the user is about
            to click, not when the dashboard mounts. */}
        <Link
          href="/dashboard/scanner"
          prefetch={false}
          data-hover-prefetch="true"
          onMouseEnter={emptyScannerHover.onMouseEnter}
          onFocus={emptyScannerHover.onFocus}
          onPointerDown={emptyScannerHover.onPointerDown}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: typography.scale.xs,
            fontWeight: 600,
            color: colors.accent,
            textDecoration: "none"
          }}
        >
          Open scanner <ArrowRight size={12} aria-hidden />
        </Link>
      </section>
    );
  }

  // ── Filled state ────────────────────────────────────────────────────────
  return (
    <section
      data-testid="dashboard-active-signal-ribbon"
      data-ribbon-state="active"
      data-ribbon-chip-count={totalChips}
      aria-label={
        dualDeskSurfaces
          ? `Active signal ribbon — ${totalChips} firing across both desks`
          : `Active signal ribbon — ${totalChips} swing setups firing`
      }
      className={surfaceGlowClassName}
      style={{
        display: "flex",
        alignItems: "center",
        gap: spacing[3],
        padding: `${spacing[3]} ${spacing[4]}`,
        borderRadius: borderRadius.lg,
        border: `1px solid color-mix(in srgb, ${colors.border} 85%, transparent)`,
        background: `linear-gradient(180deg, color-mix(in srgb, ${colors.accent} 5%, ${colors.surface}) 0%, ${colors.surface} 100%)`,
        overflow: "hidden"
      }}
    >
      <span
        style={{
          fontSize: 10,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          fontWeight: 700,
          color: colors.textMuted,
          flexShrink: 0
        }}
      >
        {dualDeskSurfaces ? "Live across desks" : "Live swing setups"}
      </span>
      <div
        data-testid="dashboard-active-signal-ribbon-track"
        style={{
          display: "flex",
          gap: spacing[2],
          overflowX: "auto",
          overflowY: "hidden",
          flex: "1 1 auto",
          minWidth: 0,
          paddingBottom: 4,
          scrollbarWidth: "thin"
        }}
      >
        {chips.map((c) => (
          <RibbonChip
            key={`${c.mode}-${c.symbol.trim().toUpperCase()}`}
            chip={c}
            colors={colors}
          />
        ))}
      </div>
    </section>
  );
}

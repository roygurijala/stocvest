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
import { useTheme } from "@/lib/theme-provider";

export interface DashboardActiveSignalRibbonProps {
  /** Swing setups, already filtered to `scanner_mode === "swing_daily"` and sorted desc by score. */
  swingSignals: IntradaySetupPayload[];
  /** Intraday setups, already filtered to NOT-swing and sorted desc by score. */
  daySignals: IntradaySetupPayload[];
  /** When the universe was empty / scanner errored, an empty-ish summary string. */
  emptyContext?: {
    swingUniverseSymbolCount?: number | null;
    scannerError?: string;
  };
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

export function DashboardActiveSignalRibbon({
  swingSignals,
  daySignals,
  emptyContext
}: DashboardActiveSignalRibbonProps) {
  const { colors } = useTheme();

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
    const universeN = emptyContext?.swingUniverseSymbolCount;
    const watchingLine =
      typeof universeN === "number" && universeN > 0
        ? `Watching ${universeN.toLocaleString()} tickers across both desks. No firing signals at the moment — both engines are still scanning.`
        : "No firing signals at the moment — both engines are still scanning. The ribbon will populate as setups come through.";
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
        <Link
          href="/dashboard/scanner"
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
      aria-label={`Active signal ribbon — ${totalChips} firing across both desks`}
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
        Live across desks
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
        {chips.map((c) => {
          const dirColor =
            c.direction === "bullish"
              ? colors.bullish
              : c.direction === "bearish"
                ? colors.bearish
                : colors.textMuted;
          const dirBg =
            c.direction === "bullish"
              ? "rgba(34,197,94,0.10)"
              : c.direction === "bearish"
                ? "rgba(239,68,68,0.10)"
                : "rgba(148,163,184,0.08)";
          const dirBorder =
            c.direction === "bullish"
              ? "rgba(34,197,94,0.36)"
              : c.direction === "bearish"
                ? "rgba(239,68,68,0.36)"
                : "rgba(148,163,184,0.28)";
          const modeColor = c.mode === "swing" ? "#a855f7" : "#00C8DC";
          const symbol = c.symbol.trim().toUpperCase();
          return (
            <Link
              key={`${c.mode}-${symbol}`}
              data-testid={`ribbon-chip-${symbol}`}
              data-ribbon-chip-mode={c.mode}
              href={`/dashboard/signals?symbol=${encodeURIComponent(symbol)}&ref=dashboard-ribbon&trading_mode=${c.mode}`}
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
                {c.mode}
              </span>
              {typeof c.score === "number" ? (
                <span
                  style={{
                    fontSize: typography.scale.xs,
                    fontWeight: 700,
                    color: colors.text,
                    marginLeft: 4,
                    fontVariantNumeric: "tabular-nums"
                  }}
                >
                  {Math.round(c.score * 100)}%
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

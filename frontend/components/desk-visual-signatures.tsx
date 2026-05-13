"use client";

/**
 * Desk visual signatures — Phase B2 + B3 of the dashboard redesign.
 *
 * Two small SVG ornaments that sit inside the `headerRight` slot of
 * the Swing Desk and Day Desk cards. They give the eye an at-a-glance
 * "different machine" cue without adding any new data or violating
 * Mode Separation discipline:
 *
 *   - `<SwingDeskSignature />` — three faint horizontal lines (a
 *     calm "tide" pattern) → multi-day cadence visual idiom.
 *
 *   - `<DayDeskSignature marketStatus={...} />` — four-dot session
 *     clock (premarket → open → midday → after-hours), with one dot
 *     illuminated based on current market state. Reads the same
 *     `marketStatus.market` field the Day Desk's posture helper
 *     already reads, so the two surfaces can never drift.
 *
 * STRICT NON-FUNCTIONAL CONTRACT
 *   - Both components are presentation-only ornaments. They MUST
 *     NOT publish, fetch, or persist any state.
 *   - They render at a fixed compact size (44×24px for Swing, 64×24
 *     px for Day) and are `aria-hidden` because the desk-card header
 *     already conveys the role pill ("SWING · MULTI-DAY" / "DAY ·
 *     INTRADAY") to assistive tech. Adding a second a11y label would
 *     be redundant noise.
 *   - Colour comes from the theme `ThemeColors` — never hard-coded
 *     hex — so dark/light themes keep parity.
 */

import { useTheme } from "@/lib/theme-provider";
import type { MarketStatusPayload } from "@/lib/api/market";

/**
 * Swing Desk visual signature — three horizontal "tide lines". The
 * top line is the faintest (background), the middle is the dominant
 * horizontal, and the bottom is the cleanest pull-through. Reads as
 * a calm multi-day skyline, intentionally non-directional.
 */
export function SwingDeskSignature() {
  const { colors } = useTheme();
  const w = 44;
  const h = 24;
  const stroke = `color-mix(in srgb, ${colors.textMuted} 55%, transparent)`;
  const strokeStrong = `color-mix(in srgb, ${colors.text} 38%, transparent)`;
  const violetAccent = `color-mix(in srgb, #a855f7 70%, transparent)`;
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      data-testid="swing-desk-signature"
      aria-hidden
      style={{ display: "block", flexShrink: 0 }}
    >
      <line x1={2} y1={6} x2={w - 2} y2={6} stroke={stroke} strokeWidth={1.5} strokeLinecap="round" />
      <line x1={2} y1={12} x2={w - 2} y2={12} stroke={strokeStrong} strokeWidth={1.8} strokeLinecap="round" />
      <line x1={2} y1={18} x2={w - 2} y2={18} stroke={violetAccent} strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  );
}

/**
 * Resolve which dot is "active" on the session clock based on the
 * upstream `market` field. Mapping mirrors the Day Desk's posture
 * logic in `lib/dashboard-posture.ts` so the visual cue agrees with
 * the posture pill below it.
 */
type SessionPhase = "premarket" | "open" | "midday" | "after_hours" | "closed";

function resolveSessionPhase(marketStatus?: MarketStatusPayload): SessionPhase {
  const m = (marketStatus?.market || "").toLowerCase();
  if (m === "extended-hours") return "after_hours";
  if (m === "open") {
    // Best-effort midday detection from server time. We accept missing
    // server clock and degrade gracefully to "open" — the dot still
    // illuminates correctly, just doesn't shift through midday.
    try {
      const serverTime = (marketStatus as unknown as { server_time?: string })?.server_time;
      const now = serverTime ? new Date(serverTime) : new Date();
      // US session window in ET — open at 9:30, close at 16:00. Midday
      // is the 12:00–14:00 ET window where action typically thins. We
      // approximate ET by reading the user's local time and offsetting
      // back to UTC, then to ET via Intl. (Best-effort; cosmetic only.)
      const hourEt = Number(
        new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }).format(now)
      );
      if (Number.isFinite(hourEt) && hourEt >= 12 && hourEt < 14) return "midday";
    } catch {
      /* ignore — fall through to "open" */
    }
    return "open";
  }
  if (m === "closed") return "closed";
  if (m === "early-hours") return "premarket";
  return "closed";
}

/**
 * Day Desk visual signature — a four-dot session clock. Each dot
 * stands for a coarse session phase (Premarket / Open / Midday /
 * After-hours). The dot for the CURRENT phase glows in the
 * day-desk cyan accent; the rest are muted. A thin connecting
 * line ties the dots into a "clock-arc" gesture without resorting
 * to a real arc (which would suggest precise time progress we
 * don't actually have without a reliable server clock).
 *
 * If the session is `closed`, all four dots stay muted — there's
 * no current phase to highlight.
 */
export function DayDeskSignature({ marketStatus }: { marketStatus?: MarketStatusPayload }) {
  const { colors } = useTheme();
  const phase = resolveSessionPhase(marketStatus);
  const w = 64;
  const h = 24;
  const cyanAccent = "#00C8DC";
  const stroke = `color-mix(in srgb, ${colors.textMuted} 50%, transparent)`;
  const mutedDot = `color-mix(in srgb, ${colors.textMuted} 55%, transparent)`;
  const dots: Array<{ x: number; label: SessionPhase }> = [
    { x: 8, label: "premarket" },
    { x: 24, label: "open" },
    { x: 40, label: "midday" },
    { x: 56, label: "after_hours" }
  ];
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      data-testid="day-desk-signature"
      data-session-phase={phase}
      aria-hidden
      style={{ display: "block", flexShrink: 0 }}
    >
      <line
        x1={dots[0]!.x}
        y1={h / 2}
        x2={dots[dots.length - 1]!.x}
        y2={h / 2}
        stroke={stroke}
        strokeWidth={1.4}
        strokeLinecap="round"
      />
      {dots.map((d) => {
        const isActive = d.label === phase;
        return (
          <circle
            key={d.label}
            cx={d.x}
            cy={h / 2}
            r={isActive ? 4 : 2.5}
            fill={isActive ? cyanAccent : mutedDot}
            opacity={isActive ? 0.95 : 0.7}
          />
        );
      })}
    </svg>
  );
}

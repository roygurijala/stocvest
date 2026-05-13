/**
 * Skeleton shell for `/dashboard/signals`.
 *
 * Tier 1.B (see `docs/PERFORMANCE.md` §1 layer 3 + §4) — the
 * `/dashboard/signals` page server-side awaits four backend calls
 * (`fetchPdtStatus` + `fetchMarketOverview` + `fetchScannerOverview`
 * + `fetchEarningsCalendar`) before rendering ANYTHING. Until those
 * resolve, the user stares at the post-navigation blank screen.
 *
 * This component renders the page **chrome** — mode tab strip,
 * two-column grid frame, card-shaped placeholders — entirely
 * without data. It is used in two places:
 *
 *   1. As the `<Suspense fallback>` inside
 *      `app/dashboard/signals/page.tsx`. The page extracts its data
 *      fetches into an async server child (`<SignalsPageData />`)
 *      wrapped in a Suspense boundary; React streams this shell to
 *      the browser immediately and swaps in the live content once
 *      the data island resolves.
 *
 *   2. As `app/dashboard/signals/loading.tsx` so Next.js renders
 *      the same shell during the route transition (e.g. when the
 *      user clicks a ribbon chip on `/dashboard`). Without that
 *      file, Next falls back to the previous page's UI during the
 *      transition, which is a worse UX for a slow target.
 *
 * Design notes:
 *
 *   * NO client-side hooks. This is a server component (no
 *     `"use client"` directive). It must render statically because
 *     it's the Suspense fallback AND the Next.js loading.tsx — both
 *     execute before any React state is available.
 *   * Mirrors the live page's `signals-grid` layout (`grid-cols-1`
 *     on mobile, `lg:grid-cols-[1.35fr_1fr]` on desktop) so the
 *     visual jump on swap-in is minimal — the cards land in the
 *     same slots.
   *   * Reuses the existing `stocvest-skeleton` keyframes defined in
 *     `app/globals.css` (horizontal shimmer used elsewhere for
 *     skeleton loaders). The subtle motion signals "loading"
 *     without spinning a centred loader that hides the page
 *     chrome. Honours `prefers-reduced-motion` because the
 *     keyframes themselves are paused under the existing media
 *     query in `globals.css`.
 *   * The mode tab strip placeholder mirrors the live `swing | day`
 *     tabs so the user sees a familiar shape, but does NOT pre-
 *     commit to a mode. The live page resolves the mode from the
 *     URL (`?trading_mode=`) on hydration; rendering a specific
 *     tab here would flash the wrong active state.
 *
 * Lock-in invariant: do NOT add data-fetching here. The whole
 * point of this component is that it renders without awaiting
 * anything.
 */

import { borderRadius, spacing, typography } from "@/lib/design-system";

/**
 * Reusable placeholder block. Pulsing background indicates load
 * state. Sized via the `style` prop so each call site controls its
 * own dimensions (we don't centralise sizes to keep call sites
 * legible).
 */
function PulseBlock({
  width = "100%",
  height,
  borderRadius: radius = borderRadius.md,
  testId
}: {
  width?: string | number;
  height: string | number;
  borderRadius?: string;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      aria-hidden
      style={{
        width,
        height,
        borderRadius: radius,
        background:
          "linear-gradient(90deg, rgba(148,163,184,0.08) 0%, rgba(148,163,184,0.22) 40%, rgba(148,163,184,0.08) 80%)",
        backgroundSize: "200% 100%",
        animation: "stocvest-skeleton 1.8s ease-in-out infinite"
      }}
    />
  );
}

/**
 * Render the signals page shell. No props — the shell is identical
 * regardless of which symbol / mode the user is navigating to.
 *
 * If we later want a per-mode shell (e.g. day-cadence pulsing for
 * day mode), we can add a `mode?: "swing" | "day"` prop and key
 * the pulse animation off it. Out of scope for Tier 1.B.
 */
export function SignalsPageShell() {
  return (
    <div
      data-testid="signals-page-shell"
      data-shell-loading="true"
      style={{ display: "grid", gap: spacing[4], padding: spacing[1] }}
    >
      {/* Mode tab strip placeholder — mirrors the live `swing | day`
          pair so the user sees the familiar shape immediately. We
          render two identical neutral placeholders and let the live
          page paint the active state on hydration. */}
      <div
        data-testid="signals-shell-mode-tabs"
        style={{
          display: "flex",
          gap: spacing[2],
          flexWrap: "wrap",
          alignItems: "center"
        }}
      >
        <PulseBlock width={120} height={36} borderRadius={borderRadius.full} testId="signals-shell-mode-tab" />
        <PulseBlock width={120} height={36} borderRadius={borderRadius.full} testId="signals-shell-mode-tab" />
        <PulseBlock width={180} height={14} borderRadius={borderRadius.sm} />
      </div>

      {/* Hero / cadence line placeholder. Two stacked short bars
          approximate the "Multi-day setups…" / "Same-session
          structure…" hint sentence the live page renders below the
          tabs. */}
      <div style={{ display: "grid", gap: spacing[2] }}>
        <PulseBlock width="60%" height={12} />
        <PulseBlock width="40%" height={10} />
      </div>

      {/* Two-column grid mirroring the live `signals-grid`
          breakpoints. The left column owns the 6-layer signal
          breakdown (taller) and the right column hosts smaller
          context cards (news, earnings, after-hours). */}
      <div
        className="signals-shell-grid grid grid-cols-1 items-start gap-4 lg:grid-cols-[1.35fr_1fr] [&>*]:min-w-0"
        data-testid="signals-shell-grid"
      >
        {/* Left column — 6-layer signal breakdown card placeholder. */}
        <div
          data-testid="signals-shell-layers-card"
          style={{
            display: "grid",
            gap: spacing[3],
            padding: spacing[4],
            borderRadius: borderRadius.xl,
            background: "rgba(148,163,184,0.04)",
            border: "1px dashed rgba(148,163,184,0.18)",
            minHeight: 320
          }}
        >
          <PulseBlock width="40%" height={16} />
          <PulseBlock width="100%" height={1} borderRadius={borderRadius.sm} />
          {/* Six layer rows. Each row pairs an icon-sized block
              with a label-sized block to evoke the live layout. */}
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              style={{ display: "flex", alignItems: "center", gap: spacing[3] }}
            >
              <PulseBlock width={28} height={28} borderRadius={borderRadius.md} />
              <div style={{ flex: 1, display: "grid", gap: spacing[1] }}>
                <PulseBlock width="55%" height={12} />
                <PulseBlock width="80%" height={10} />
              </div>
              <PulseBlock width={56} height={18} borderRadius={borderRadius.full} />
            </div>
          ))}
        </div>

        {/* Right column — three smaller context cards stacked. */}
        <div style={{ display: "grid", gap: spacing[4], minWidth: 0 }}>
          {(["news", "earnings", "after-hours"] as const).map((slot) => (
            <div
              key={slot}
              data-testid={`signals-shell-${slot}-card`}
              style={{
                display: "grid",
                gap: spacing[2],
                padding: spacing[4],
                borderRadius: borderRadius.lg,
                background: "rgba(148,163,184,0.04)",
                border: "1px dashed rgba(148,163,184,0.18)",
                minHeight: 140
              }}
            >
              <PulseBlock width="50%" height={14} />
              <PulseBlock width="100%" height={1} borderRadius={borderRadius.sm} />
              <PulseBlock width="90%" height={10} />
              <PulseBlock width="80%" height={10} />
              <PulseBlock width="70%" height={10} />
            </div>
          ))}
        </div>
      </div>

      {/* sr-only status for AT users: the visible skeleton has no
          text, but screen readers MUST announce that the page is
          loading. role=status + aria-live=polite is the standard
          pairing for "in progress" announcements. */}
      <p
        role="status"
        aria-live="polite"
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: "hidden",
          clip: "rect(0,0,0,0)",
          whiteSpace: "nowrap",
          border: 0,
          fontSize: typography.scale.xs
        }}
      >
        Loading signal data…
      </p>
    </div>
  );
}

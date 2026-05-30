"use client";

import { DashboardIndexChip } from "@/components/dashboard/dashboard-index-chip";
import { DashboardMarketContextPanelBody } from "@/components/dashboard/dashboard-market-context-panel";
import type { MarketContextSnapshot } from "@/lib/market-context/snapshot";
import type { SectorRotationChip } from "@/lib/market-context/types";
import { InfoTip } from "@/components/info-tip";
import { interactionLevelProps } from "@/lib/dashboard/click-hierarchy";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  pageTitle: string;
  regimeLabel: string;
  regimeTip: string;
  marketContext: MarketContextSnapshot;
  spyPct: number | null;
  qqqPct: number | null;
  iwmPct: number | null;
  vixLevel: number | null;
  vixPct: number | null;
  vixPulseOk: boolean;
  sectorRotation: SectorRotationChip[];
  systemLabel: string;
  swingDeskPhrase: string;
  dayDeskPhrase?: string;
  dayTradingSurfaces?: boolean;
  scannerPending?: boolean;
};

function fmtPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

function topSectors(chips: SectorRotationChip[]): { lead: SectorRotationChip | null; lag: SectorRotationChip | null } {
  const sorted = [...chips].filter((c) => c.pct5d != null && Number.isFinite(c.pct5d));
  sorted.sort((a, b) => (b.pct5d ?? 0) - (a.pct5d ?? 0));
  return { lead: sorted[0] ?? null, lag: sorted[sorted.length - 1] ?? null };
}

type SessionTapeCell = {
  label: string;
  pct: number | null;
  formattedPct?: string;
  extra?: string;
};

function buildSessionTapeCells(
  spyPct: number | null,
  qqqPct: number | null,
  iwmPct: number | null,
  vixPulseOk: boolean,
  vixPct: number | null,
  vixLevel: number | null
): SessionTapeCell[] {
  const cells: SessionTapeCell[] = [
    { label: "SPY", pct: spyPct },
    { label: "QQQ", pct: qqqPct },
    { label: "IWM", pct: iwmPct }
  ];
  const hasVixPct = vixPct != null && Number.isFinite(vixPct);
  const hasVixLevel = vixLevel != null && Number.isFinite(vixLevel);
  if (vixPulseOk && (hasVixPct || hasVixLevel)) {
    cells.push({
      label: "VIX",
      pct: hasVixPct ? vixPct : null,
      formattedPct: hasVixPct ? fmtPct(vixPct) : `$${vixLevel!.toFixed(2)}`,
      extra: hasVixPct && hasVixLevel ? `$${vixLevel!.toFixed(2)}` : undefined
    });
  }
  return cells;
}

export function DashboardMarketPulseHero({
  pageTitle,
  regimeLabel,
  regimeTip,
  marketContext,
  spyPct,
  qqqPct,
  iwmPct,
  vixLevel,
  vixPct,
  vixPulseOk,
  sectorRotation,
  systemLabel,
  swingDeskPhrase,
  dayDeskPhrase,
  dayTradingSurfaces = true,
  scannerPending = false
}: Props) {
  const { colors } = useTheme();
  const { lead, lag } = topSectors(sectorRotation);
  const environmentSummary = marketContext.environmentSummary;
  const sessionTapeCells = buildSessionTapeCells(spyPct, qqqPct, iwmPct, vixPulseOk, vixPct, vixLevel);

  return (
    <section
      role="region"
      aria-label="Market pulse"
      data-testid="dashboard-market-pulse-hero"
      className={surfaceGlowClassName}
      style={{
        borderRadius: borderRadius.lg,
        border: `1px solid color-mix(in srgb, ${colors.border} 80%, ${colors.accent} 20%)`,
        background: `linear-gradient(135deg, color-mix(in srgb, ${colors.surface} 92%, ${colors.accent} 8%) 0%, ${colors.surface} 100%)`,
        padding: `${spacing[4]} ${spacing[4]}`
      }}
    >
      <h1
        data-testid="dashboard-page-title"
        className="m-0 text-xl font-bold md:text-2xl"
        style={{ color: colors.text }}
      >
        {pageTitle}
      </h1>
      <p
        data-testid="dashboard-pulse-headline"
        className="m-0 mt-2"
        style={{ fontSize: typography.scale.base, color: colors.text, lineHeight: 1.45 }}
      >
        <span style={{ fontWeight: 700, color: colors.accent }}>{regimeLabel}</span>
        <span style={{ color: colors.textMuted }}> · </span>
        {environmentSummary}
      </p>

      <p
        className="m-0 mt-3 text-[10px] font-semibold uppercase tracking-wide"
        style={{ color: colors.textMuted }}
        data-testid="dashboard-pulse-session-heading"
      >
        Today (session)
      </p>
      <p className="m-0 mt-0.5" style={{ fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.4 }}>
        Index moves since the open — live tape, not 5-day trend.
      </p>
      <div
        className="mt-2 grid w-full gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
        data-testid="dashboard-pulse-tape"
        {...interactionLevelProps("none")}
      >
        {sessionTapeCells.map((cell) => {
          const pct = cell.pct;
          const formattedPct = cell.formattedPct ?? fmtPct(pct);
          const tone =
            pct == null || !Number.isFinite(pct) ? "muted" : pct > 0.05 ? "bullish" : pct < -0.05 ? "bearish" : "muted";
          return (
            <div key={cell.label} className="min-w-0">
              <DashboardIndexChip
                symbol={cell.label}
                horizon="today"
                formattedPct={formattedPct}
                tone={tone}
                extra={cell.extra}
                testId={`dashboard-pulse-${cell.label}`}
              />
            </div>
          );
        })}
        {lead ? (
          <div
            data-testid="dashboard-pulse-sector-lead"
            className="min-w-0"
            style={{
              borderRadius: borderRadius.md,
              border: `1px solid ${colors.border}`,
              padding: `${spacing[2]} ${spacing[3]}`,
              background: colors.surfaceMuted,
              height: "100%"
            }}
          >
            <div style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>Leading (5d)</div>
            <div style={{ fontSize: typography.scale.sm, fontWeight: 600 }}>
              {lead.label}{" "}
              <span style={{ color: colors.bullish }}>{fmtPct(lead.pct5d)}</span>
            </div>
          </div>
        ) : null}
        {lag && lag.symbol !== lead?.symbol ? (
          <div
            data-testid="dashboard-pulse-sector-lag"
            className="min-w-0"
            style={{
              borderRadius: borderRadius.md,
              border: `1px solid ${colors.border}`,
              padding: `${spacing[2]} ${spacing[3]}`,
              background: colors.surfaceMuted,
              height: "100%"
            }}
          >
            <div style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>Lagging (5d)</div>
            <div style={{ fontSize: typography.scale.sm, fontWeight: 600 }}>
              {lag.label}{" "}
              <span style={{ color: colors.bearish }}>{fmtPct(lag.pct5d)}</span>
            </div>
          </div>
        ) : null}
      </div>

      <p className="m-0 mt-2" style={{ fontSize: typography.scale.sm, color: colors.textMuted }}>
        <strong style={{ color: colors.text }}>Desk:</strong> {systemLabel}
        {scannerPending ? " · Scanner still loading" : ""}
        <span {...interactionLevelProps("light")} className="ml-1 inline-flex align-middle">
          <InfoTip text={regimeTip} label="How regime is read" maxWidth={300} />
        </span>
      </p>

      <details className="mt-2" data-testid="dashboard-market-detail" open>
        <summary
          style={{
            fontSize: typography.scale.sm,
            fontWeight: 600,
            color: colors.accent,
            cursor: "pointer",
            listStylePosition: "outside"
          }}
        >
          Market detail
        </summary>
        <div
          className="mt-3"
          data-testid="dashboard-market-context"
          style={{
            borderRadius: borderRadius.md,
            border: `1px solid ${colors.border}`,
            background: colors.surface,
            padding: spacing[3]
          }}
        >
          <p
            className="m-0 text-[10px] font-semibold uppercase tracking-wide"
            style={{ color: colors.textMuted }}
          >
            Desk posture
          </p>
          <ul
            className="m-0 mt-1.5 list-disc pl-4"
            data-testid="dashboard-pulse-desk-detail"
            style={{
              color: colors.textMuted,
              fontSize: typography.scale.xs,
              lineHeight: 1.5
            }}
          >
            <li>Swing: {swingDeskPhrase}</li>
            {dayTradingSurfaces && dayDeskPhrase ? <li>Day: {dayDeskPhrase}</li> : null}
          </ul>
          <div className="mt-4 border-t pt-4" style={{ borderColor: colors.border }}>
            <DashboardMarketContextPanelBody
              snapshot={marketContext}
              showSummary={false}
              showSessionToday={false}
            />
          </div>
        </div>
      </details>
    </section>
  );
}

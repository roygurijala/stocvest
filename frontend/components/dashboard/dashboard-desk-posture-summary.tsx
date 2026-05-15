"use client";

import { InfoTip } from "@/components/info-tip";
import type { DayDeskPostureKind } from "@/lib/dashboard-posture";
import { interactionLevelProps } from "@/lib/dashboard/click-hierarchy";
import { borderRadius, roleAccents, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

const SWING_POSTURE_TIP =
  "Swing Desk posture reflects regime, sector tape, and whether multi-day setups are firing. Active means ranked swing setups are present.";
const DAY_POSTURE_TIP =
  "Day Desk posture reflects session timing and intraday setup confirmation. Suppressed means session closed or no qualifying day setups.";

export type DashboardDeskPostureSummaryProps = {
  swingPosture: "active" | "monitor" | "suppressed";
  dayPosture?: DayDeskPostureKind;
  showDayDesk?: boolean;
};

function postureLabel(posture: string): string {
  return posture.replace(/_/g, " ");
}

function postureColor(
  posture: string,
  colors: { bullish: string; caution: string; textMuted: string }
): string {
  if (posture === "active") return colors.bullish;
  if (posture === "monitor" || posture === "monitor_only") return colors.caution;
  return colors.textMuted;
}

/** Compact dual-desk posture cards above the desk grid (Phase 3). */
export function DashboardDeskPostureSummary({
  swingPosture,
  dayPosture,
  showDayDesk = true
}: DashboardDeskPostureSummaryProps) {
  const { colors, theme } = useTheme();
  const swingRail = roleAccents[theme].swing.borderAccent;
  const dayRail = roleAccents[theme].day.borderAccent;

  return (
    <div
      role="region"
      aria-label="Desk postures"
      data-testid="dashboard-desk-posture-summary"
      className={`grid gap-3 ${showDayDesk ? "sm:grid-cols-2" : "grid-cols-1"}`}
    >
      <article
        {...interactionLevelProps("none")}
        data-testid="dashboard-swing-posture-card"
        data-desk-posture={swingPosture}
        className={surfaceGlowClassName}
        style={{
          padding: spacing[3],
          borderRadius: borderRadius.lg,
          border: `1px solid ${colors.border}`,
          background: colors.surface,
          borderLeft: `4px solid ${swingRail}`
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <p
            style={{
              margin: 0,
              fontSize: typography.scale.xs,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: colors.textMuted
            }}
          >
            Swing desk posture
          </p>
          <span {...interactionLevelProps("light")}>
            <InfoTip text={SWING_POSTURE_TIP} label="About swing desk posture" maxWidth={280} />
          </span>
        </div>
        <p
          style={{
            margin: `${spacing[2]} 0 0`,
            fontSize: typography.scale.lg,
            fontWeight: 700,
            textTransform: "capitalize",
            color: postureColor(swingPosture, colors)
          }}
        >
          {postureLabel(swingPosture)}
        </p>
      </article>

      {showDayDesk && dayPosture ? (
        <article
          {...interactionLevelProps("none")}
          data-testid="dashboard-day-posture-card"
          data-desk-posture={dayPosture}
          className={surfaceGlowClassName}
          style={{
            padding: spacing[3],
            borderRadius: borderRadius.lg,
            border: `1px solid ${colors.border}`,
            background: colors.surface,
            borderLeft: `4px solid ${dayRail}`
          }}
        >
          <div className="flex items-start justify-between gap-2">
            <p
              style={{
                margin: 0,
                fontSize: typography.scale.xs,
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: colors.textMuted
              }}
            >
              Day desk posture
            </p>
            <span {...interactionLevelProps("light")}>
              <InfoTip text={DAY_POSTURE_TIP} label="About day desk posture" maxWidth={280} />
            </span>
          </div>
          <p
            style={{
              margin: `${spacing[2]} 0 0`,
              fontSize: typography.scale.lg,
              fontWeight: 700,
              textTransform: "capitalize",
              color: postureColor(dayPosture, colors)
            }}
          >
            {postureLabel(dayPosture)}
          </p>
        </article>
      ) : null}
    </div>
  );
}

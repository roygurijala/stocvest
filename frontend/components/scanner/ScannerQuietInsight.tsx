"use client";

import { spacing, typography } from "@/lib/design-system";
import type { ClosestQualifyingGroup } from "@/lib/scanner-quiet-copy";
import { SCANNER_INSIGHT_SESSION_KEY } from "@/lib/scanner/scanner-disclosure-prefs";
import type { ScannerSynthesis } from "@/lib/scanner-synthesis";
import type { ScannerEvaluationTraceRow } from "@/lib/scanner-setups-response";
import { useTheme } from "@/lib/theme-provider";
import { ScannerCollapsible } from "@/components/scanner/ScannerCollapsible";
import { ScannerEvaluationDetails } from "@/components/scanner/ScannerEvaluationDetails";

type Props = {
  bullets: string[];
  closestGroups: ClosestQualifyingGroup[];
  synthesis?: ScannerSynthesis | null;
  traceRows?: ScannerEvaluationTraceRow[];
  deskFilter?: "swing" | "day" | "all";
};

function insightHint(closest: number, hasWhy: boolean, hasEval: boolean): string {
  const parts: string[] = [];
  if (closest > 0) parts.push(`${closest} near threshold`);
  if (hasWhy) parts.push("market context");
  if (hasEval) parts.push("gate breakdown");
  return parts.join(" · ");
}

/**
 * Single optional drill-down on quiet scans — keeps the default view minimal.
 */
export function ScannerQuietInsight({
  bullets,
  closestGroups,
  synthesis,
  traceRows = [],
  deskFilter = "all"
}: Props) {
  const { colors } = useTheme();
  const closestCount = closestGroups.reduce((n, g) => n + g.items.length, 0);
  const hasClosest = closestCount > 0;
  const hasWhy = bullets.length > 0;
  const hasEval =
    (synthesis?.rejection_groups.session_volume.length ?? 0) +
      (synthesis?.rejection_groups.liquidity.length ?? 0) +
      (synthesis?.rejection_groups.structure.length ?? 0) >
      0 || traceRows.length > 0;

  if (!hasClosest && !hasWhy && !hasEval) return null;

  return (
    <ScannerCollapsible
      testId="scanner-quiet-insight"
      title="Scan insight"
      hint={insightHint(closestCount, hasWhy, hasEval)}
      persistSessionKey={SCANNER_INSIGHT_SESSION_KEY}
    >
      <div style={{ display: "grid", gap: spacing[3] }}>
        {hasClosest ? (
          <div data-testid="scanner-closest-to-qualifying">
            <p
              style={{
                margin: `0 0 ${spacing[1]}`,
                fontSize: typography.scale.xs,
                fontWeight: 600,
                color: colors.textMuted
              }}
            >
              Closest to qualifying
            </p>
            {closestGroups.map((group) => (
              <ul
                key={group.label}
                style={{
                  margin: group === closestGroups[0] ? 0 : `${spacing[2]} 0 0`,
                  padding: 0,
                  listStyle: "none",
                  display: "grid",
                  gap: 4
                }}
              >
                {group.items.map((row) => (
                  <li
                    key={`${group.label}-${row.symbol}`}
                    data-testid={`scanner-closest-${row.symbol}`}
                    style={{ fontSize: typography.scale.sm, color: colors.text }}
                  >
                    <span className="font-mono font-semibold">{row.symbol}</span>
                    <span style={{ color: colors.textMuted }}> · {row.detail}</span>
                  </li>
                ))}
              </ul>
            ))}
          </div>
        ) : null}

        {hasWhy ? (
          <ul
            style={{
              margin: 0,
              padding: `0 0 0 ${spacing[3]}`,
              display: "grid",
              gap: 4,
              fontSize: typography.scale.sm,
              color: colors.textMuted,
              lineHeight: 1.45
            }}
          >
            {bullets.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}

        {hasEval ? (
          <ScannerEvaluationDetails
            synthesis={synthesis}
            traceRows={traceRows}
            deskFilter={deskFilter}
            embedded
          />
        ) : null}
      </div>
    </ScannerCollapsible>
  );
}

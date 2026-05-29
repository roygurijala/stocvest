"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { InfoTip } from "@/components/info-tip";
import {
  buildExecutionReadyCounts,
  buildExecutionReadyPills,
  EXECUTION_READY_STRIP_HINT,
  EXECUTION_READY_STRIP_TITLE,
  executionReadyStripVisible
} from "@/lib/dashboard/execution-ready-strip-present";
import type { DashboardDeskMode } from "@/lib/dashboard/live-status-copy";
import { interactionLevelProps } from "@/lib/dashboard/click-hierarchy";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useHoverPrefetch } from "@/lib/hooks/use-hover-prefetch";
import type { ScannerScanSummary } from "@/lib/scanner-scan-summary";
import { parseMaturationSummaryEnvelope } from "@/lib/watchlist/maturation-summary-envelope";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  mode: DashboardDeskMode;
  scanSummary: ScannerScanSummary | null | undefined;
  scannerPending?: boolean;
  systemSuppressed?: boolean;
};

export function DashboardExecutionReadyStrip({
  mode,
  scanSummary,
  scannerPending = false,
  systemSuppressed = false
}: Props) {
  const { colors } = useTheme();
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [bySymbol, setBySymbol] = useState(parseMaturationSummaryEnvelope({}).bySymbol);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    void (async () => {
      try {
        const res = await fetch(
          `/api/stocvest/watchlists/maturation-summary?mode=${encodeURIComponent(mode)}`,
          { cache: "no-store" }
        );
        if (cancelled) return;
        if (!res.ok) {
          setStatus("error");
          return;
        }
        const json = await res.json().catch(() => ({}));
        if (!cancelled) {
          setBySymbol(parseMaturationSummaryEnvelope(json).bySymbol);
          setStatus("ready");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode]);

  const deskLabel = mode === "swing" ? "Swing" : "Day";
  const counts = useMemo(
    () => buildExecutionReadyCounts({ bySymbol, scanSummary, mode }),
    [bySymbol, scanSummary, mode]
  );
  const pills = useMemo(
    () => buildExecutionReadyPills({ counts, mode, deskLabel }),
    [counts, mode, deskLabel]
  );
  const loading = status === "idle" || status === "loading" || scannerPending;
  const visible = executionReadyStripVisible({ counts, loading, systemSuppressed: Boolean(systemSuppressed) });

  if (!visible) return null;

  return (
    <section
      role="region"
      aria-label="Execution-ready setups"
      data-testid="dashboard-execution-ready-strip"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: spacing[3],
        padding: `${spacing[2]} ${spacing[3]}`,
        borderRadius: borderRadius.lg,
        border: `1px solid color-mix(in srgb, ${colors.bullish} 35%, ${colors.border})`,
        background: `color-mix(in srgb, ${colors.bullish} 8%, ${colors.surface})`
      }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span
          style={{
            fontSize: typography.scale.xs,
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: colors.bullish
          }}
        >
          {EXECUTION_READY_STRIP_TITLE}
        </span>
        <InfoTip text={EXECUTION_READY_STRIP_HINT} label="About cleared desk gates" />
        <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>{deskLabel} desk</span>
      </div>
      <div className="flex flex-wrap items-center gap-2" data-testid="dashboard-execution-ready-pills">
        {pills.map((pill) => (
          <ExecutionReadyPillLink key={pill.id} pill={pill} />
        ))}
      </div>
    </section>
  );
}

function ExecutionReadyPillLink({
  pill
}: {
  pill: ReturnType<typeof buildExecutionReadyPills>[number];
}) {
  const { colors } = useTheme();
  const hover = useHoverPrefetch(pill.href);

  return (
    <Link
      href={pill.href}
      prefetch={false}
      data-testid={`dashboard-execution-ready-pill-${pill.id}`}
      aria-label={pill.ariaLabel}
      {...interactionLevelProps("deep")}
      {...hover}
      className="inline-flex items-center gap-2 rounded-full no-underline transition hover:brightness-105"
      style={{
        padding: `${spacing[1]} ${spacing[3]}`,
        border: `1px solid color-mix(in srgb, ${colors.bullish} 45%, ${colors.border})`,
        background: colors.surface,
        color: colors.text,
        fontSize: typography.scale.sm,
        fontWeight: 600
      }}
    >
      <span
        aria-hidden
        className="inline-flex min-w-[1.35rem] items-center justify-center rounded-full px-1.5 text-xs font-bold tabular-nums"
        style={{
          background: `color-mix(in srgb, ${colors.bullish} 22%, transparent)`,
          color: colors.bullish
        }}
      >
        {pill.count}
      </span>
      {pill.label}
    </Link>
  );
}

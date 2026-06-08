"use client";

import { useEffect, useMemo, useState } from "react";
import { ScannerTerminal } from "@/components/scanner/terminal/scanner-terminal";
import { loadScannerDataWithoutBrief } from "@/lib/api/scanner-client-load";
import type { ScannerOverview, ScannerSetupLoadMode } from "@/lib/api/scanner";
import { mergeScannerCoreIntoOverview } from "@/lib/scanner-overview-merge";
import { fetchScannerEvaluationTraceClient } from "@/lib/api/scanner-trace-client";
import type { ScannerEvaluationTraceRow } from "@/lib/scanner-setups-response";
import { buildScannerScanSummary, nearRowsFromSetups } from "@/lib/scanner-scan-summary";
import { useDeskToday } from "@/lib/hooks/use-desk-today";
import { useDashboardPayload } from "@/lib/hooks/use-dashboard-payload";
import { parseSectorRotationEnvelope } from "@/lib/scanner/terminal/scanner-terminal-sector-themes";
import { useTheme } from "@/lib/theme-provider";
import { spacing, typography } from "@/lib/design-system";

const EMPTY_OVERVIEW: ScannerOverview = {
  gapIntelligence: [],
  setups: [],
  spyPct: null,
  qqqPct: null,
  regimeLabel: "Neutral",
  swingUniverseSymbolCount: null,
  gapIntelligenceSnapshotSymbolCount: null
};

type Props = {
  initialScannerSetupLoadMode: ScannerSetupLoadMode;
  dayTradingSurfaces: boolean;
};

export function ScannerTerminalPreviewContent({
  initialScannerSetupLoadMode,
  dayTradingSurfaces,
  showPreviewBadge = false
}: Props) {
  const { colors } = useTheme();
  const [overview, setOverview] = useState<ScannerOverview>(EMPTY_OVERVIEW);
  const [scannerSetupMode] = useState<ScannerSetupLoadMode>(initialScannerSetupLoadMode);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [watchlistSymbols, setWatchlistSymbols] = useState<string[]>([]);
  const [evaluationTrace, setEvaluationTrace] = useState<ScannerEvaluationTraceRow[]>([]);

  const { data: swingDeskRes } = useDeskToday("swing");
  const { data: dayDeskRes } = useDeskToday("day", { fallbackData: undefined });
  const { data: dashboardPayload } = useDashboardPayload("swing");
  const sectorRotation = parseSectorRotationEnvelope(dashboardPayload?.sector_rotation);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const core = await loadScannerDataWithoutBrief(null, [], {
        parallelDefaultWatchlist: true,
        includeOpportunityDeskUniverse: true,
        maxUniverseSymbols: 150,
        scannerSetupLoadMode: scannerSetupMode,
        intradayBarLimit: 120,
        daySetupsLimit: 10,
        swingSetupsLimit: 6
      });
      if (cancelled) return;
      if (!core.error) {
        setOverview((prev) => mergeScannerCoreIntoOverview(prev, core));
        setLoadedAt(new Date().toISOString());
      }
      try {
        const trace = await fetchScannerEvaluationTraceClient(scannerSetupMode, 24);
        if (!cancelled) setEvaluationTrace(trace);
      } catch {
        /* ignore */
      }
      try {
        const wl = await fetch("/api/stocvest/watchlists/default/symbols", { cache: "no-store" });
        if (wl.ok) {
          const body = (await wl.json()) as { symbols?: string[] };
          if (!cancelled && Array.isArray(body.symbols)) {
            setWatchlistSymbols(body.symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean));
          }
        }
      } catch {
        /* ignore */
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [scannerSetupMode]);

  const nearQualification = useMemo(() => {
    const nearSetups = overview.setups.filter((s) => s.qualification_tier === "near");
    return nearRowsFromSetups(nearSetups);
  }, [overview.setups]);

  const scanSummary = useMemo(() => {
    if (overview.scanSummary) return overview.scanSummary;
    if (!loadedAt) return null;
    return buildScannerScanSummary({
      scannedAtIso: loadedAt,
      overview,
      nearQualificationSetups: overview.setups.filter((s) => s.qualification_tier === "near"),
      watchlistProgression: []
    });
  }, [overview, loadedAt]);

  const updatedLabel = useMemo(() => {
    if (!loadedAt) return null;
    const mins = Math.max(0, Math.round((Date.now() - new Date(loadedAt).getTime()) / 60000));
    if (mins < 1) return "just now";
    return `${mins}m ago`;
  }, [loadedAt]);

  if (loading && overview.setups.length === 0 && overview.gapIntelligence.length === 0) {
    return (
      <p style={{ padding: spacing[4], margin: 0, fontSize: typography.scale.sm, color: colors.textMuted }}>
        Loading scanner funnel…
      </p>
    );
  }

  return (
    <ScannerTerminal
      overview={overview}
      swingDesk={swingDeskRes?.data ?? null}
      dayDesk={dayTradingSurfaces ? dayDeskRes?.data ?? null : null}
      nearQualification={nearQualification}
      watchlistSymbols={watchlistSymbols}
      dayTradingSurfaces={dayTradingSurfaces}
      evaluationTrace={evaluationTrace}
      scanSummary={scanSummary}
      synthesis={overview.scannerSynthesis ?? null}
      sectorRotation={sectorRotation}
      showPreviewBadge={showPreviewBadge}
      updatedLabel={updatedLabel}
    />
  );
}

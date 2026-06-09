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
import { fetchIpoEcosystems, type IpoEcosystemPayload } from "@/lib/api/fetch-ipo-ecosystems";
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
  showPreviewBadge?: boolean;
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
  const [refreshing, setRefreshing] = useState(false);
  const [ipoEcosystems, setIpoEcosystems] = useState<IpoEcosystemPayload[]>([]);

  const { data: swingDeskRes } = useDeskToday("swing");
  const { data: dayDeskRes } = useDeskToday("day", { fallbackData: undefined });
  const { data: dashboardPayload } = useDashboardPayload("swing");
  const sectorRotation = parseSectorRotationEnvelope(dashboardPayload?.sector_rotation);

  const loadScanner = async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    else setRefreshing(true);
    const core = await loadScannerDataWithoutBrief(null, [], {
      parallelDefaultWatchlist: true,
      includeOpportunityDeskUniverse: true,
      maxUniverseSymbols: 150,
      scannerSetupLoadMode: scannerSetupMode,
      intradayBarLimit: 120,
      daySetupsLimit: 10,
      swingSetupsLimit: 6
    });
    if (!core.error) {
      setOverview((prev) => mergeScannerCoreIntoOverview(prev, core));
      setLoadedAt(new Date().toISOString());
    }
    try {
      const trace = await fetchScannerEvaluationTraceClient(scannerSetupMode, 24);
      setEvaluationTrace(trace);
    } catch {
      /* ignore */
    }
    try {
      const ecosystems = await fetchIpoEcosystems();
      setIpoEcosystems(ecosystems);
    } catch {
      /* ignore */
    }
    try {
      const wl = await fetch("/api/stocvest/watchlists/default/symbols", { cache: "no-store" });
      if (wl.ok) {
        const body = (await wl.json()) as { symbols?: string[] };
        if (Array.isArray(body.symbols)) {
          setWatchlistSymbols(body.symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean));
        }
      }
    } catch {
      /* ignore */
    }
    if (!opts?.silent) setLoading(false);
    else setRefreshing(false);
  };

  useEffect(() => {
    void loadScanner();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load only
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
      ipoEcosystems={ipoEcosystems}
      showPreviewBadge={showPreviewBadge}
      onRefresh={() => void loadScanner({ silent: true })}
      refreshing={refreshing}
      sessionUpdatedAtIso={loadedAt}
    />
  );
}

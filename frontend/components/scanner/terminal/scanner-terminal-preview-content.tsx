"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { scannerTerminalLoadTuning } from "@/lib/scanner/terminal/scanner-terminal-load-tuning";

const EMPTY_OVERVIEW: ScannerOverview = {
  gapIntelligence: [],
  setups: [],
  spyPct: null,
  qqqPct: null,
  regimeLabel: "Neutral",
  swingUniverseSymbolCount: null,
  gapIntelligenceSnapshotSymbolCount: null,
  gapIpoWatch: []
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
  const [overview, setOverview] = useState<ScannerOverview>(EMPTY_OVERVIEW);
  const [scannerSetupMode] = useState<ScannerSetupLoadMode>(initialScannerSetupLoadMode);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [bootstrapLoading, setBootstrapLoading] = useState(true);
  const [watchlistSymbols, setWatchlistSymbols] = useState<string[]>([]);
  const [evaluationTrace, setEvaluationTrace] = useState<ScannerEvaluationTraceRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [ipoEcosystems, setIpoEcosystems] = useState<IpoEcosystemPayload[]>([]);

  const { data: swingDeskRes } = useDeskToday("swing");
  const { data: dayDeskRes } = useDeskToday("day", { fallbackData: undefined });
  const { data: dashboardPayload } = useDashboardPayload("swing");
  const sectorRotation = parseSectorRotationEnvelope(dashboardPayload?.sector_rotation);

  const loadSecondaryData = useCallback(async () => {
    await Promise.all([
      fetchIpoEcosystems()
        .then((ecosystems) => setIpoEcosystems(ecosystems))
        .catch(() => undefined),
      fetch("/api/stocvest/watchlists/default/symbols", { cache: "no-store" })
        .then(async (wl) => {
          if (!wl.ok) return;
          const body = (await wl.json()) as { symbols?: string[] };
          if (Array.isArray(body.symbols)) {
            setWatchlistSymbols(body.symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean));
          }
        })
        .catch(() => undefined),
      fetchScannerEvaluationTraceClient(scannerSetupMode, 24)
        .then((trace) => {
          if (trace.length) setEvaluationTrace(trace);
        })
        .catch(() => undefined)
    ]);
  }, [scannerSetupMode]);

  const loadScanner = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setBootstrapLoading(true);
      else setRefreshing(true);

      try {
        const core = await loadScannerDataWithoutBrief(null, [], scannerTerminalLoadTuning(scannerSetupMode));
        if (!core.error) {
          setOverview((prev) => mergeScannerCoreIntoOverview(prev, core));
          setLoadedAt(new Date().toISOString());
          if (core.evaluationTrace?.length) {
            setEvaluationTrace(core.evaluationTrace);
          }
        } else {
          setOverview((prev) => ({ ...prev, error: core.error }));
        }
      } finally {
        if (!opts?.silent) setBootstrapLoading(false);
        else setRefreshing(false);
      }

      void loadSecondaryData();
    },
    [loadSecondaryData, scannerSetupMode]
  );

  useEffect(() => {
    void loadScanner();
  }, [loadScanner]);

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
      bootstrapLoading={bootstrapLoading}
      onRefresh={() => void loadScanner({ silent: true })}
      refreshing={refreshing}
      sessionUpdatedAtIso={loadedAt}
    />
  );
}

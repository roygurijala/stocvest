import type { ScannerScanSummary } from "@/lib/scanner-scan-summary";
import type { DayDeskPostureKind } from "@/lib/dashboard-posture";

export type DashboardDeskMode = "swing" | "day";

export type LiveStatusCopy = {
  deskTitle: string;
  headline: string;
  ctaLabel: string;
  ctaHref: string;
  suppressedCallout?: string;
};

function nearReadyCountForDesk(summary: ScannerScanSummary | null | undefined, mode: DashboardDeskMode): number {
  if (!summary?.near_qualification || !Array.isArray(summary.near_qualification)) return 0;
  return summary.near_qualification.filter((r) => r.desk === mode).length;
}

function readyCountForDesk(summary: ScannerScanSummary | null | undefined, mode: DashboardDeskMode): number {
  const q = summary?.qualifying;
  if (!q || typeof q !== "object") return 0;
  const swing = typeof q.swing === "number" && Number.isFinite(q.swing) ? q.swing : 0;
  const day = typeof q.day === "number" && Number.isFinite(q.day) ? q.day : 0;
  return mode === "swing" ? swing : day;
}

export function buildLiveStatusCopy(opts: {
  mode: DashboardDeskMode;
  swingDeskActive: boolean;
  dayDeskPosture: DayDeskPostureKind;
  scanSummary?: ScannerScanSummary | null;
  systemSuppressed: boolean;
}): LiveStatusCopy {
  const scannerHref = opts.mode === "swing" ? "/dashboard/scanner?mode=swing" : "/dashboard/scanner?mode=day";
  const deskTitle = opts.mode === "swing" ? "Swing desk" : "Day desk";
  const near = nearReadyCountForDesk(opts.scanSummary, opts.mode);
  const ready = readyCountForDesk(opts.scanSummary, opts.mode);

  if (opts.mode === "swing") {
    if (opts.swingDeskActive && ready > 0) {
      return {
        deskTitle,
        headline: `${ready} actionable setup${ready === 1 ? "" : "s"}`,
        ctaLabel: "Open Scanner →",
        ctaHref: scannerHref
      };
    }
    if (near > 0) {
      return {
        deskTitle,
        headline: "No actionable signals",
        ctaLabel: `Explore Scanner (${near} near-ready setup${near === 1 ? "" : "s"}) →`,
        ctaHref: scannerHref
      };
    }
    return {
      deskTitle,
      headline: "No actionable signals",
      ctaLabel: "Explore Scanner →",
      ctaHref: scannerHref,
      suppressedCallout: opts.systemSuppressed
        ? "Signals are currently suppressed. Wait for structure to improve."
        : undefined
    };
  }

  const dayActive = opts.dayDeskPosture === "active";
  if (dayActive && ready > 0) {
    return {
      deskTitle,
      headline: `${ready} actionable setup${ready === 1 ? "" : "s"}`,
      ctaLabel: "Open Scanner →",
      ctaHref: scannerHref
    };
  }
  if (near > 0) {
    return {
      deskTitle,
      headline: "No actionable signals",
      ctaLabel: `Explore Scanner (${near} near-ready setup${near === 1 ? "" : "s"}) →`,
      ctaHref: scannerHref
    };
  }
  return {
    deskTitle,
    headline: "No actionable signals",
    ctaLabel: "Explore Scanner →",
    ctaHref: scannerHref,
    suppressedCallout: opts.systemSuppressed
      ? "Signals are currently suppressed. Wait for structure to improve."
      : undefined
  };
}

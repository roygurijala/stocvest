"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import type { GapIntelligenceItem, IntradaySetupPayload } from "@/lib/api/scanner";
import type { DeskRetainedPoolRow, DeskTodayData, DeskTodayMode } from "@/lib/api/desk-today";
import type { ThemeColors } from "@/lib/design-system";
import { typography } from "@/lib/design-system";
import { useHoverPrefetch } from "@/lib/hooks/use-hover-prefetch";

/** Per-setup Signals deep link — hover-prefetch without mount prefetch (PERFORMANCE.md §4). */
function ScannerOpenSignalsLink(props: { href: string; borderColor: string; accentColor: string }) {
  const hoverPrefetch = useHoverPrefetch(props.href);
  return (
    <Link
      prefetch={false}
      data-hover-prefetch="true"
      href={props.href}
      onMouseEnter={hoverPrefetch.onMouseEnter}
      onFocus={hoverPrefetch.onFocus}
      onPointerDown={hoverPrefetch.onPointerDown}
      className="inline-flex min-h-8 items-center rounded-md px-2 text-xs font-medium no-underline"
      style={{ border: `1px solid ${props.borderColor}`, color: props.accentColor, alignSelf: "center" }}
    >
      Open Signals
    </Link>
  );
}

const SCANNER_MODE_STORAGE_KEY = "stocvest_scanner_mode";
const SECONDARY_SHARED_CATALYST_HEADLINE = "Referenced in related news — see primary ticker";

const MONO = typography.fontFamilyMono;

function gapItemDisplayCompany(item: GapIntelligenceItem): string {
  const a = item.company_name;
  const b = (item as { companyName?: string }).companyName;
  return (typeof a === "string" && a.trim() ? a : typeof b === "string" ? b : "").trim();
}

const CONFLUENCE_BADGE_STYLE: CSSProperties = {
  background: "linear-gradient(135deg, #b8860b, #f5c542)",
  color: "#1a1200",
  fontSize: "10px",
  fontWeight: 700,
  letterSpacing: "2px",
  padding: "3px 10px",
  borderRadius: "4px",
  textTransform: "uppercase"
};

function isLongDirection(direction: string): boolean {
  return ["bullish", "long"].includes(direction.toLowerCase());
}

function formatSignalFiredTimeEt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
}

function isSecondarySharedCatalyst(item: GapIntelligenceItem): boolean {
  const h = item.catalyst?.headline;
  return typeof h === "string" && h.trim() === SECONDARY_SHARED_CATALYST_HEADLINE;
}

type DeskRejectionSnapshot = {
  rejectionReasonCounts: Record<string, number>;
  rejectedSamples: Array<{ symbol: string; reason: string }>;
  retainedPool: Array<
    DeskRetainedPoolRow & {
      symbol: string;
      desk: DeskTodayMode;
    }
  >;
  survivorLimitUsed: number;
};

const EMPTY_DESK_REJECTION_SNAPSHOT: DeskRejectionSnapshot = {
  rejectionReasonCounts: {},
  rejectedSamples: [],
  retainedPool: [],
  survivorLimitUsed: 0
};

function extractDeskRejectionSnapshot(
  data: DeskTodayData | null | undefined,
  mode: DeskTodayMode
): DeskRejectionSnapshot {
  const rejectionReasonCounts =
    data?.rejection_reason_counts && typeof data.rejection_reason_counts === "object"
      ? data.rejection_reason_counts
      : {};
  const rejectedSamples = Array.isArray(data?.rejected_samples)
    ? data.rejected_samples
        .map((row) => ({
          symbol: String(row.symbol ?? "").trim().toUpperCase(),
          reason: String(row.reason ?? "").trim()
        }))
        .filter((row) => row.symbol && row.reason)
    : [];
  const retainedPool = Array.isArray(data?.retained_pool)
    ? data.retained_pool
        .map((row) => {
          const direction: "up" | "down" = row.direction === "down" ? "down" : "up";
          return {
            symbol: String(row.symbol ?? "").trim().toUpperCase(),
            gap_percent: Number(row.gap_percent ?? 0),
            direction,
            rank_score: Number(row.rank_score ?? 0),
            day_volume: Number(row.day_volume ?? 0),
            session_price: Number(row.session_price ?? 0),
            rank_position: Number(row.rank_position ?? 0),
            desk: mode
          };
        })
        .filter((row) => row.symbol)
    : [];
  const survivorLimitUsed =
    typeof data?.survivor_limit_used === "number" && Number.isFinite(data.survivor_limit_used)
      ? Math.max(0, Math.floor(data.survivor_limit_used))
      : retainedPool.length;
  return {
    rejectionReasonCounts,
    rejectedSamples,
    retainedPool,
    survivorLimitUsed
  };
}

function qualityBarStyle(score: number, colors: ThemeColors): { fill: string; glow?: string } {
  if (score >= 80) return { fill: "#4ade80", glow: "0 0 12px rgba(74,222,128,0.45)" };
  if (score >= 60) return { fill: colors.bullish };
  if (score >= 40) return { fill: colors.caution };
  return { fill: colors.bearish };
}

function gapSyntheticSetup(item: GapIntelligenceItem): IntradaySetupPayload {
  return {
    symbol: item.symbol,
    direction: item.gap_pct >= 0 ? "long" : "short",
    score: Math.min(0.99, item.gap_quality_score / 100),
    triggers: ["gap_intelligence"],
    timestamp_iso: new Date().toISOString()
  };
}

export {
  ScannerOpenSignalsLink,
  SCANNER_MODE_STORAGE_KEY,
  SECONDARY_SHARED_CATALYST_HEADLINE,
  MONO,
  gapItemDisplayCompany,
  CONFLUENCE_BADGE_STYLE,
  isLongDirection,
  formatSignalFiredTimeEt,
  isSecondarySharedCatalyst,
  EMPTY_DESK_REJECTION_SNAPSHOT,
  extractDeskRejectionSnapshot,
  qualityBarStyle,
  gapSyntheticSetup,
};
export type { DeskRejectionSnapshot };

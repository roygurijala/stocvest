import type { ThemeColors } from "@/lib/design-system";
import { REGIME_BADGE_TIP, REGIME_WITHOUT_VIX_APPEND } from "@/lib/ui-tooltips";

export function regimeLabelIsDirectional(regimeLabel: string): boolean {
  const r = regimeLabel.trim().toLowerCase();
  return r.includes("bear") || r.includes("bull");
}

export function regimeFromSpyQqq(spyPct: number | null, qqqPct: number | null, fallback: string): string {
  if (spyPct != null && qqqPct != null) {
    if (spyPct > 0.2 && qqqPct > 0.15) return "Bullish";
    if (spyPct < -0.2 || qqqPct < -0.25) return "Bearish";
    return "Neutral";
  }
  return fallback;
}

export function resolveRegimeLabel(opts: {
  scannerError?: string;
  scannerRegimeLabel?: string;
  spyPct: number | null;
  qqqPct: number | null;
}): { label: string; useScannerRegime: boolean } {
  const spyFromScanner =
    typeof opts.spyPct === "number" && Number.isFinite(opts.spyPct) && opts.spyPct > -99.5 ? opts.spyPct : null;
  const qqqFromScanner =
    typeof opts.qqqPct === "number" && Number.isFinite(opts.qqqPct) && opts.qqqPct > -99.5 ? opts.qqqPct : null;
  const useScannerRegime = !opts.scannerError && spyFromScanner != null && qqqFromScanner != null;
  const label = useScannerRegime
    ? (opts.scannerRegimeLabel ?? "Neutral")
    : regimeFromSpyQqq(spyFromScanner, qqqFromScanner, opts.scannerRegimeLabel ?? "Neutral");
  return { label, useScannerRegime };
}

export function regimeBadgeExplanation(vixPulseOk: boolean): string {
  if (vixPulseOk) return REGIME_BADGE_TIP;
  return `${REGIME_BADGE_TIP}${REGIME_WITHOUT_VIX_APPEND}`;
}

export function regimeOneLiner(regimeLabel: string, priceBreadthOnly: boolean): string {
  const r = regimeLabel.trim().toLowerCase();
  const base = r.includes("bull")
    ? "Index price + breadth lean upside"
    : r.includes("bear")
      ? "Index price + breadth lean downside"
      : r.includes("neutral") || r.includes("mixed") || r.includes("range")
        ? "Index price + breadth mixed"
        : "Regime input pending";
  return priceBreadthOnly ? `${base} (VIX unavailable)` : base;
}

export function regimeTone(regimeLabel: string, colors: ThemeColors) {
  const r = regimeLabel.trim().toLowerCase();
  if (r.includes("bull")) {
    return {
      kind: "risk-on" as const,
      fg: colors.bullish,
      bg: "rgba(34,197,94,0.10)",
      border: "rgba(34,197,94,0.36)"
    };
  }
  if (r.includes("bear")) {
    return {
      kind: "risk-off" as const,
      fg: colors.bearish,
      bg: "rgba(239,68,68,0.10)",
      border: "rgba(239,68,68,0.36)"
    };
  }
  if (r.includes("neutral") || r.includes("mixed") || r.includes("range")) {
    return {
      kind: "mixed" as const,
      fg: colors.caution,
      bg: "rgba(245,158,11,0.10)",
      border: "rgba(245,158,11,0.36)"
    };
  }
  return {
    kind: "unknown" as const,
    fg: colors.textMuted,
    bg: "rgba(148,163,184,0.10)",
    border: "rgba(148,163,184,0.36)"
  };
}

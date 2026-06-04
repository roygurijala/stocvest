/**
 * VWAP display helpers for the evidence card. Split out of `signal-evidence.ts`
 * (which re-exports them). Self-contained; no external deps.
 */

/** Mirrors backend ``VWAPState`` for client display. */
export const VWAP_STATE = {
  PRE_MARKET: "pre_market",
  FORMING: "forming",
  AVAILABLE: "available",
  POST_MARKET: "post_market"
} as const;

export function getVWAPTooltip(state?: string): string {
  const tooltips: Record<string, string> = {
    pre_market: "VWAP resets at 9:30 AM ET. Not available pre-market.",
    forming: "VWAP is calculating from early session bars.",
    available: "Volume Weighted Average Price since market open.",
    post_market: "VWAP is an RTH-only indicator. Not available post-market."
  };
  return tooltips[state ?? ""] ?? "Intraday volume-weighted price level.";
}

export function getVWAPDisplay(
  vwapValue: number | null | undefined,
  vwapState: string | undefined,
  price: number | null | undefined,
  vwapDisplay: string | undefined,
  serverTooltip?: string | undefined
): { label: string; muted: boolean; tooltip: string; state?: string } {
  if (vwapDisplay && vwapDisplay.trim()) {
    const st = vwapState?.trim();
    const muted = st !== VWAP_STATE.AVAILABLE;
    const tip = (serverTooltip && serverTooltip.trim()) || (st ? getVWAPTooltip(st) : getVWAPTooltip());
    return {
      label: vwapDisplay.trim(),
      muted,
      tooltip: tip,
      state: st
    };
  }
  if (vwapValue != null && Number.isFinite(vwapValue) && vwapValue > 0) {
    const direction = price != null && Number.isFinite(price) && price >= vwapValue ? "— Above" : "— Below";
    return {
      label: `VWAP $${vwapValue.toFixed(2)} ${direction}`.trim(),
      muted: false,
      tooltip: getVWAPTooltip(VWAP_STATE.AVAILABLE),
      state: VWAP_STATE.AVAILABLE
    };
  }
  return {
    label: "VWAP starts at 9:30 ET",
    muted: true,
    tooltip: "VWAP resets each session at open.",
    state: VWAP_STATE.PRE_MARKET
  };
}

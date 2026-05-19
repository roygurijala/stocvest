/** Map backend “% below expected” to a 0–100 fill for volume gap bars (closer to qualifying = more fill). */

export function volumeFillFromPctBelow(pctBelow: number): number {
  if (!Number.isFinite(pctBelow)) return 0;
  return Math.max(0, Math.min(100, Math.round(100 - pctBelow)));
}

export function volumeGapAriaLabel(symbol: string, fillPct: number, pctBelow?: number): string {
  const fill = Math.max(0, Math.min(100, Math.round(fillPct)));
  if (pctBelow != null && Number.isFinite(pctBelow)) {
    return `${symbol}: ${fill}% of required session volume (${Math.round(pctBelow)}% below pace)`;
  }
  return `${symbol}: ${fill}% of required session volume`;
}

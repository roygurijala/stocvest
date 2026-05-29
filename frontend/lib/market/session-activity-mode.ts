import type { MarketStatusPayload } from "@/lib/api/market";
import { isRegularSessionOpen } from "@/lib/market/regular-session";

export type SessionActivityUiMode = "live" | "extended" | "closed";

function marketFlag(marketStatus: Pick<MarketStatusPayload, "market"> | null | undefined): string {
  return (marketStatus?.market ?? "").trim().toLowerCase();
}

function isExtendedHoursMarket(flag: string): boolean {
  return flag === "extended-hours" || flag === "extendedhours";
}

export function resolveSessionActivityUiMode(
  marketStatus: Pick<MarketStatusPayload, "market"> | null | undefined
): SessionActivityUiMode {
  const mkt = marketFlag(marketStatus);
  if (!mkt) return "live";
  if (isRegularSessionOpen(marketStatus)) return "live";
  if (isExtendedHoursMarket(mkt)) return "extended";
  return "closed";
}

export function sessionActivityClosedSummary(count: number): string {
  if (count <= 0) return "Session closed — no movers logged.";
  const noun = count === 1 ? "mover" : "movers";
  return `Session closed — ${count} ${noun} logged. Review tomorrow.`;
}

export function sessionActivityExtendedHint(): string {
  return "Extended hours — context only; intraday gates resume at the regular open.";
}

export function sessionActivitySubtitleSuffix(mode: SessionActivityUiMode): string | null {
  if (mode === "extended") return sessionActivityExtendedHint();
  if (mode === "closed") return "Post-close log — not actionable until the next session.";
  return null;
}

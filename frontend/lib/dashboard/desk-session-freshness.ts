/**
 * Session Activity desk cache freshness — yesterday's movers must not show as today's context.
 */

import type { DeskTodayData } from "@/lib/api/desk-today";
import type { SessionActivityUiMode } from "@/lib/market/session-activity-mode";

export function nyTradingDateIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

function generatedAtTradingDateEt(iso: string | undefined | null): string | null {
  if (!iso?.trim()) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return nyTradingDateIso(d);
}

export function deskSessionTradingDate(data: DeskTodayData | null | undefined): string | null {
  const explicit = data?.session_trading_date?.trim();
  if (explicit) return explicit;
  return generatedAtTradingDateEt(data?.generated_at);
}

/**
 * During live or extended hours, desk movers from a prior NY session are stale.
 * Post-close mode intentionally keeps the prior session log.
 */
export function isDeskSessionActivityStale(
  data: DeskTodayData | null | undefined,
  sessionMode: SessionActivityUiMode
): boolean {
  if (sessionMode === "closed") return false;
  const deskDate = deskSessionTradingDate(data);
  if (!deskDate) return false;
  return deskDate !== nyTradingDateIso();
}

export function sessionActivityAwaitingTodayMessage(): string {
  return "Waiting for today's session — movers refresh after the regular open.";
}

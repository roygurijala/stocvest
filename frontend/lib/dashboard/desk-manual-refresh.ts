/**
 * Client-side manual desk refresh cooldown (mirrors server 5 min; instant UI disable).
 */

import { DESK_MANUAL_REFRESH_COOLDOWN_MS } from "@/lib/dashboard/desk-refresh-tiers";

const STORAGE_KEY = "stocvest:desk:manual-refresh-at";

export function readDeskManualRefreshAt(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function markDeskManualRefreshAt(atMs: number = Date.now()): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(atMs));
  } catch {
    /* ignore quota */
  }
}

export function deskManualRefreshCooldownRemainingMs(nowMs: number = Date.now()): number {
  const at = readDeskManualRefreshAt();
  if (at == null) return 0;
  const elapsed = nowMs - at;
  if (elapsed >= DESK_MANUAL_REFRESH_COOLDOWN_MS) return 0;
  return DESK_MANUAL_REFRESH_COOLDOWN_MS - elapsed;
}

export function canDeskManualRefreshNow(nowMs: number = Date.now()): boolean {
  return deskManualRefreshCooldownRemainingMs(nowMs) <= 0;
}

export function formatCooldownRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min <= 0) return `${sec}s`;
  return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
}

/**
 * Dashboard discovery diff since last visit (localStorage).
 */

import type { DeskTodayMode } from "@/lib/api/desk-today";

const STORAGE_KEY_PREFIX = "stocvest:dashboard:desk-last-visit";

export type DeskLastVisitSnapshot = {
  visitedAt: string;
  discoverySymbols: string[];
};

function storageKey(mode: DeskTodayMode): string {
  return `${STORAGE_KEY_PREFIX}:${mode}`;
}

export function loadDeskLastVisit(mode: DeskTodayMode): DeskLastVisitSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(mode));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DeskLastVisitSnapshot;
    if (!parsed?.visitedAt || !Array.isArray(parsed.discoverySymbols)) return null;
    return {
      visitedAt: String(parsed.visitedAt),
      discoverySymbols: parsed.discoverySymbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean)
    };
  } catch {
    return null;
  }
}

export function saveDeskLastVisit(
  symbols: string[],
  mode: DeskTodayMode,
  at: Date = new Date()
): void {
  if (typeof window === "undefined") return;
  const discoverySymbols = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const payload: DeskLastVisitSnapshot = {
    visitedAt: at.toISOString(),
    discoverySymbols
  };
  try {
    window.localStorage.setItem(storageKey(mode), JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

export function diffDeskSinceLastVisit(
  currentSymbols: string[],
  previous: DeskLastVisitSnapshot | null
): { added: string[]; removed: string[] } {
  if (!previous) return { added: [], removed: [] };
  const cur = new Set(currentSymbols.map((s) => s.trim().toUpperCase()).filter(Boolean));
  const prev = new Set(previous.discoverySymbols);
  const added = [...cur].filter((s) => !prev.has(s));
  const removed = [...prev].filter((s) => !cur.has(s));
  return { added, removed };
}

export function sinceLastVisitSummary(added: string[], removed: string[]): string | null {
  const parts: string[] = [];
  if (added.length > 0) {
    const label = added.length === 1 ? added[0] : `${added.length} new`;
    parts.push(`${label} entered market activity list`);
  }
  if (removed.length > 0) {
    const label = removed.length === 1 ? `${removed[0]} left the list` : `${removed.length} left the list`;
    parts.push(label);
  }
  if (parts.length === 0) return null;
  return parts.join(" · ");
}

/**
 * Dashboard discovery diff since last visit (localStorage).
 */

const STORAGE_KEY = "stocvest:dashboard:desk-last-visit";

export type DeskLastVisitSnapshot = {
  visitedAt: string;
  discoverySymbols: string[];
};

export function loadDeskLastVisit(): DeskLastVisitSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
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

export function saveDeskLastVisit(symbols: string[], at: Date = new Date()): void {
  if (typeof window === "undefined") return;
  const discoverySymbols = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const payload: DeskLastVisitSnapshot = {
    visitedAt: at.toISOString(),
    discoverySymbols
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
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
    parts.push(`${label} in discovery`);
  }
  if (removed.length > 0) {
    const label = removed.length === 1 ? `${removed[0]} dropped` : `${removed.length} dropped`;
    parts.push(label);
  }
  if (parts.length === 0) return null;
  return parts.join(" · ");
}

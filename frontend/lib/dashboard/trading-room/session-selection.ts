/**
 * Trading Room center-panel selection memory.
 *
 * Intentionally MODULE-SCOPED (not sessionStorage): the value lives as long as
 * the JS bundle is loaded. That yields exactly the desired UX:
 *
 *   - Hard refresh / fresh login  → bundle reloads → memory empty → Brief shows.
 *   - SPA navigate away + back     → bundle stays alive → selection restored.
 *
 * No timestamps, no storage parsing, no cross-tab leakage.
 */
let lastSelectedId: string | null = null;

export function getLastSelectedId(): string | null {
  return lastSelectedId;
}

export function setLastSelectedId(id: string | null): void {
  lastSelectedId = id;
}

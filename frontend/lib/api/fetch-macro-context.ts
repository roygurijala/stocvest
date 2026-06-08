import type { MacroUpcomingEventWire, MacroYieldCurveWire } from "@/lib/signal-evidence";

/**
 * GET /v1/market/macro-context — routed through the same-origin Next.js proxy
 * (`/api/stocvest/market/macro-context`) so the server attaches the httpOnly
 * session token and avoids API Gateway CORS failures from localhost.
 */
export interface MacroContextPayload {
  upcoming_events: MacroUpcomingEventWire[];
  warnings: string[];
  macro_risk: string;
  macro_risk_level?: string;
  yield_curve: MacroYieldCurveWire | null;
  /** Weighted macro regime from the backend engine: risk_on | neutral | risk_off | avoid. */
  market_regime?: string | null;
  /** Composite macro score 0–100 that the regime is derived from. */
  macro_score?: number | null;
}

export async function fetchMacroContext(): Promise<MacroContextPayload | null> {
  try {
    const res = await fetch("/api/stocvest/market/macro-context", {
      method: "GET",
      cache: "no-store"
    });
    if (!res.ok) {
      return null;
    }
    const row = (await res.json()) as MacroContextPayload;
    return row ?? null;
  } catch {
    return null;
  }
}

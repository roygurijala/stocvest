import { readWsTokenFromDocumentCookie } from "@/lib/auth/ws-token-cookie";
import { surfaceAuthErrorIfAny } from "@/lib/auth/surface-auth-error";

import type { MacroUpcomingEventWire, MacroYieldCurveWire } from "@/lib/signal-evidence";

const DEFAULT_BASE_URL = "http://localhost:3001";

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_STOCVEST_API_BASE_URL || DEFAULT_BASE_URL;
}

/** GET /v1/market/macro-context — client-safe (cookie bearer). */
export interface MacroContextPayload {
  upcoming_events: MacroUpcomingEventWire[];
  warnings: string[];
  macro_risk: string;
  macro_risk_level?: string;
  yield_curve: MacroYieldCurveWire | null;
}

export async function fetchMacroContext(): Promise<MacroContextPayload | null> {
  const token = readWsTokenFromDocumentCookie();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  try {
    const res = await fetch(`${apiBaseUrl()}/v1/market/macro-context`, {
      method: "GET",
      credentials: "include",
      headers,
      cache: "no-store"
    });
    if (!res.ok) {
      void surfaceAuthErrorIfAny(res);
      return null;
    }
    const row = (await res.json()) as MacroContextPayload;
    return row ?? null;
  } catch {
    return null;
  }
}

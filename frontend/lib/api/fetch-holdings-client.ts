/**
 * Client-safe CRUD for the manual portfolio via the same-origin BFF
 * (`/api/stocvest/holdings*`). Session-cookie auth is added server-side by the
 * BFF route handlers (`stocvestAuthedFetch`).
 */
import type { Holding, HoldingInput, PortfolioSettings } from "@/lib/portfolio/types";
import { DEFAULT_PORTFOLIO_SETTINGS } from "@/lib/portfolio/types";

async function parseJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function fetchHoldingsClient(): Promise<Holding[]> {
  const res = await fetch("/api/stocvest/holdings", { method: "GET", cache: "no-store" }).catch(
    () => null
  );
  if (!res?.ok) return [];
  return (await parseJson<Holding[]>(res)) ?? [];
}

/**
 * Load holdings + settings together and report whether the fetch actually failed,
 * so the UI can distinguish "empty portfolio" from "couldn't reach the server"
 * instead of silently rendering zeros. Values fall back to safe defaults on error.
 */
export async function loadPortfolioBundleClient(): Promise<{
  holdings: Holding[];
  settings: PortfolioSettings;
  error: boolean;
}> {
  const [hRes, sRes] = await Promise.all([
    fetch("/api/stocvest/holdings", { method: "GET", cache: "no-store" }).catch(() => null),
    fetch("/api/stocvest/holdings/settings", { method: "GET", cache: "no-store" }).catch(() => null)
  ]);
  const error = !hRes?.ok || !sRes?.ok;
  const holdings = hRes?.ok ? (await parseJson<Holding[]>(hRes)) ?? [] : [];
  const settings = sRes?.ok
    ? (await parseJson<PortfolioSettings>(sRes)) ?? { ...DEFAULT_PORTFOLIO_SETTINGS }
    : { ...DEFAULT_PORTFOLIO_SETTINGS };
  return { holdings, settings, error };
}

/**
 * Result of a holding upsert. On failure we carry the HTTP status + the backend's
 * own message (`{error, message}`) so the UI can show WHY a save failed instead of a
 * generic "Check the values" — the reason is usually the write path (e.g. the holdings
 * route/table not deployed → 403/500), not the user's input.
 */
export type UpsertHoldingResult =
  | { ok: true; holding: Holding }
  | { ok: false; status: number; message: string };

const _GENERIC_SAVE_ERROR = "Could not save. Please try again.";

export async function upsertHoldingClient(holding: HoldingInput): Promise<UpsertHoldingResult> {
  const res = await fetch("/api/stocvest/holdings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(holding),
    cache: "no-store"
  }).catch(() => null);
  if (!res) {
    return {
      ok: false,
      status: 0,
      message: "Couldn't reach the server. Check your connection and try again."
    };
  }
  if (!res.ok) {
    const body = await parseJson<{ message?: string; error?: string }>(res);
    const detail = body?.message || body?.error;
    const message =
      res.status === 401 || res.status === 403
        ? `Save was rejected (HTTP ${res.status}). You may be signed out, or the holdings service isn't available in this environment.`
        : detail || `${_GENERIC_SAVE_ERROR} (HTTP ${res.status})`;
    return { ok: false, status: res.status, message };
  }
  const saved = await parseJson<Holding>(res);
  if (!saved) {
    return { ok: false, status: res.status, message: "The server returned an unexpected response." };
  }
  return { ok: true, holding: saved };
}

/**
 * Record a stock split for a held symbol. `ratio` is new-shares-per-old-share
 * (2:1 forward = 2, 1:10 reverse = 0.1). Returns the adjusted holding, or null.
 */
export async function applyHoldingSplitClient(
  symbol: string,
  ratio: number
): Promise<Holding | null> {
  const res = await fetch(`/api/stocvest/holdings/${encodeURIComponent(symbol)}/split`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ratio }),
    cache: "no-store"
  }).catch(() => null);
  if (!res?.ok) return null;
  return parseJson<Holding>(res);
}

export async function deleteHoldingClient(symbol: string): Promise<boolean> {
  const res = await fetch(`/api/stocvest/holdings/${encodeURIComponent(symbol)}`, {
    method: "DELETE",
    cache: "no-store"
  }).catch(() => null);
  return Boolean(res?.ok);
}

export async function fetchPortfolioSettingsClient(): Promise<PortfolioSettings> {
  const res = await fetch("/api/stocvest/holdings/settings", {
    method: "GET",
    cache: "no-store"
  }).catch(() => null);
  if (!res?.ok) return { ...DEFAULT_PORTFOLIO_SETTINGS };
  return (await parseJson<PortfolioSettings>(res)) ?? { ...DEFAULT_PORTFOLIO_SETTINGS };
}

export async function savePortfolioSettingsClient(
  settings: PortfolioSettings
): Promise<PortfolioSettings | null> {
  const res = await fetch("/api/stocvest/holdings/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(settings),
    cache: "no-store"
  }).catch(() => null);
  if (!res?.ok) return null;
  return parseJson<PortfolioSettings>(res);
}

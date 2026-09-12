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

export async function upsertHoldingClient(holding: HoldingInput): Promise<Holding | null> {
  const res = await fetch("/api/stocvest/holdings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(holding),
    cache: "no-store"
  }).catch(() => null);
  if (!res?.ok) return null;
  return parseJson<Holding>(res);
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

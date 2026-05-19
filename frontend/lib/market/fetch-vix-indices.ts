import type { SnapshotPayload } from "@/lib/api/market";
import { pickUsableVixSnapshot } from "@/lib/api/market-snapshot-helpers";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

/** Polygon indices snapshot row (subset). */
type IndicesRow = {
  ticker?: string;
  error?: string;
  value?: number;
  session?: {
    close?: number;
    change_percent?: number;
    previous_close?: number;
  };
};

function numish(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function indicesRowToSnapshot(row: IndicesRow): SnapshotPayload | null {
  const level = numish(row.value) ?? numish(row.session?.close);
  const changePct = numish(row.session?.change_percent);
  const prev = numish(row.session?.previous_close);
  if (level == null && changePct == null) return null;
  return {
    symbol: String(row.ticker || "I:VIX").toUpperCase(),
    last_trade_price: level ?? undefined,
    day_close: level ?? undefined,
    change_percent: changePct ?? undefined,
    prev_close: prev ?? undefined
  };
}

/** Prefer Lambda (Secrets Manager Polygon key), then local POLYGON_API_KEY fallbacks. */
export async function fetchVixSnapshotForDashboard(): Promise<SnapshotPayload | null> {
  try {
    const apiRes = await stocvestAuthedFetch("/v1/market/vix-snapshot", { method: "GET" });
    if (apiRes.ok) {
      const body = (await apiRes.json().catch(() => ({}))) as { snapshot?: SnapshotPayload | null };
      const snap = body.snapshot;
      if (snap && pickUsableVixSnapshot([snap])) return snap;
    }
  } catch {
    /* fall through */
  }

  try {
    const batchRes = await stocvestAuthedFetch(
      `/v1/market/snapshots?symbols=${encodeURIComponent("I:VIX,^VIX,VIX")}`,
      { method: "GET" }
    );
    if (batchRes.ok) {
      const body = (await batchRes.json().catch(() => ({}))) as { snapshots?: SnapshotPayload[] };
      const picked = pickUsableVixSnapshot(Array.isArray(body.snapshots) ? body.snapshots : []);
      if (picked) return picked as SnapshotPayload;
    }
  } catch {
    /* fall through */
  }

  const indices = await fetchVixIndicesSnapshotDirect();
  if (indices) return indices;
  return fetchVixStocksSnapshotDirect();
}

/** Direct Polygon indices API (requires POLYGON_API_KEY on this host). */
export async function fetchVixIndicesSnapshotDirect(): Promise<SnapshotPayload | null> {
  const key = process.env.POLYGON_API_KEY?.trim();
  if (!key) return null;
  const url = new URL("https://api.polygon.io/v3/snapshot/indices");
  url.searchParams.set("ticker.any_of", "I:VIX,^VIX,VIX");
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store"
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as { results?: IndicesRow[] } | null;
  for (const sym of ["I:VIX", "^VIX", "VIX"]) {
    const row = data?.results?.find((r) => r.ticker === sym && !r.error);
    if (!row) continue;
    const snap = indicesRowToSnapshot(row);
    if (snap && pickUsableVixSnapshot([snap])) return snap;
  }
  return null;
}

/** Direct Polygon stocks snapshot (index tickers sometimes live here). */
export async function fetchVixStocksSnapshotDirect(): Promise<SnapshotPayload | null> {
  const key = process.env.POLYGON_API_KEY?.trim();
  if (!key) return null;
  for (const sym of ["I:VIX", "^VIX", "VIX"]) {
    const url = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(sym)}?apiKey=${encodeURIComponent(key)}`;
    let res: Response;
    try {
      res = await fetch(url, { cache: "no-store" });
    } catch {
      continue;
    }
    if (!res.ok) continue;
    const data = (await res.json().catch(() => null)) as { ticker?: Record<string, unknown> } | null;
    const ticker = data?.ticker;
    if (!ticker || typeof ticker !== "object") continue;
    const day = (ticker.day as Record<string, unknown>) || {};
    const last = ticker.lastTrade as Record<string, unknown> | undefined;
    const prevDay = (ticker.prevDay as Record<string, unknown>) || {};
    let level: number | null = null;
    const lp = last?.p;
    if (lp != null && lp !== "") {
      const n = Number(lp);
      if (Number.isFinite(n) && n > 0) level = n;
    }
    if (level == null && day.c != null && day.c !== "") {
      const n = Number(day.c);
      if (Number.isFinite(n) && n > 0) level = n;
    }
    const prev = prevDay.c != null ? Number(prevDay.c) : null;
    let changePct: number | null = null;
    if (ticker.todaysChangePerc != null) {
      const n = Number(ticker.todaysChangePerc);
      if (Number.isFinite(n)) changePct = n;
    } else if (level != null && prev != null && prev !== 0) {
      changePct = ((level - prev) / prev) * 100;
    }
    if (level == null && changePct == null) continue;
    const snap: SnapshotPayload = {
      symbol: sym,
      last_trade_price: level ?? undefined,
      day_close: level ?? undefined,
      change_percent: changePct ?? undefined,
      prev_close: prev ?? undefined
    };
    if (pickUsableVixSnapshot([snap])) return snap;
  }
  return null;
}

/** @deprecated Use fetchVixSnapshotForDashboard */
export async function fetchVixIndicesSnapshot(): Promise<SnapshotPayload | null> {
  return fetchVixSnapshotForDashboard();
}

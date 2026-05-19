import type { SnapshotPayload } from "@/lib/api/market";

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

/** Server or edge: fetch VIX from Polygon indices API when stocks tape omits it. */
export async function fetchVixIndicesSnapshot(): Promise<SnapshotPayload | null> {
  const key = process.env.POLYGON_API_KEY?.trim();
  if (!key) return null;
  const url = new URL("https://api.polygon.io/v3/snapshot/indices");
  url.searchParams.set("ticker.any_of", "I:VIX");
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
  const row = data?.results?.find((r) => r.ticker === "I:VIX" && !r.error);
  if (!row) return null;
  const level = numish(row.value) ?? numish(row.session?.close);
  const changePct = numish(row.session?.change_percent);
  const prev = numish(row.session?.previous_close);
  if (level == null && changePct == null) return null;
  return {
    symbol: "I:VIX",
    last_trade_price: level ?? undefined,
    day_close: level ?? undefined,
    change_percent: changePct ?? undefined,
    prev_close: prev ?? undefined
  };
}

/**
 * Parse composite `catalyst_headlines` / `catalysts` for layer detail drawers.
 */

export type LayerCatalystArticle = {
  text: string;
  sentiment: "positive" | "negative" | "neutral";
  source?: string;
  publishedAt?: string;
  url?: string;
  sentimentScore?: number;
};

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function parseOne(raw: Record<string, unknown>): LayerCatalystArticle | null {
  const text = String(raw.text ?? raw.title ?? "").trim();
  if (!text) return null;
  const ss = numOrNull(raw.sentiment_score);
  const sentRaw = String(
    raw.sentiment ?? (ss != null ? (ss > 0 ? "positive" : ss < 0 ? "negative" : "neutral") : "neutral")
  ).toLowerCase();
  const sentiment =
    sentRaw === "positive" || sentRaw === "negative" || sentRaw === "neutral" ? sentRaw : "neutral";
  const source = String(raw.source ?? "").trim() || undefined;
  const publishedRaw = raw.published_at ?? raw.published_utc;
  const publishedAt =
    publishedRaw != null && String(publishedRaw).trim() !== "" ? String(publishedRaw).trim() : undefined;
  const urlRaw = raw.url ?? raw.article_url;
  const url = urlRaw != null && String(urlRaw).trim() !== "" ? String(urlRaw).trim() : undefined;
  return {
    text: text.slice(0, 240),
    sentiment,
    source,
    publishedAt,
    url,
    sentimentScore: ss ?? undefined
  };
}

export function parseLayerCatalystArticles(raw: unknown, limit = 8): LayerCatalystArticle[] {
  if (!Array.isArray(raw)) return [];
  const out: LayerCatalystArticle[] = [];
  for (const item of raw.slice(0, limit * 2)) {
    if (item && typeof item === "object") {
      const row = parseOne(item as Record<string, unknown>);
      if (row) out.push(row);
    } else if (typeof item === "string" && item.trim()) {
      out.push({ text: item.trim().slice(0, 240), sentiment: "neutral" });
    }
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}

function dedupeKey(text: string): string {
  return text.trim().toLowerCase().slice(0, 160);
}

function mergeArticleLists(primary: LayerCatalystArticle[], secondary: LayerCatalystArticle[], limit: number): LayerCatalystArticle[] {
  const map = new Map<string, LayerCatalystArticle>();
  const keys: string[] = [];
  for (const row of [...primary, ...secondary]) {
    const k = dedupeKey(row.text);
    if (!k) continue;
    if (!map.has(k)) {
      map.set(k, row);
      keys.push(k);
    }
  }
  return keys.slice(0, limit).map((k) => map.get(k)!);
}

/** Headlines from composite top-level fields (same source as Evidence card catalysts). */
export function catalystArticlesFromComposite(
  composite: Record<string, unknown> | null | undefined,
  limit = 8
): LayerCatalystArticle[] {
  if (!composite) return [];
  const fromHeadlines = parseLayerCatalystArticles(composite.catalyst_headlines, limit);
  const fromCatalysts = parseLayerCatalystArticles(composite.catalysts, limit);
  if (fromHeadlines.length > 0) {
    return mergeArticleLists(fromHeadlines, fromCatalysts, limit);
  }
  return fromCatalysts.slice(0, limit);
}

/** Prefer layer-level `quality_articles` (all scored headlines) over top-level catalyst_headlines. */
export function catalystArticlesForNewsLayer(
  entry: Record<string, unknown> | undefined,
  composite: Record<string, unknown> | null | undefined,
  limit = 8
): LayerCatalystArticle[] {
  const fromLayer = parseLayerCatalystArticles(entry?.quality_articles, limit);
  if (fromLayer.length > 0) return fromLayer;
  return catalystArticlesFromComposite(composite, limit);
}

export function formatCatalystSourceLabel(source: string | undefined): string {
  const s = source?.trim();
  if (!s) return "News";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export function truncateCatalystHeadline(text: string, max = 120): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max).trimEnd()}…`;
}

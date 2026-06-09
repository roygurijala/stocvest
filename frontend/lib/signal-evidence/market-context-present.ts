/**
 * Advisory IPO / index-inclusion context from composite `market_context_flags`.
 */

export type MarketContextFlags = {
  ipo_unseasoned: boolean;
  index_inclusion_window: boolean;
  listed_days: number | null;
  ecosystem_entity: string | null;
  ecosystem_role: string | null;
  warnings: string[];
};

export type MarketContextDampening = {
  dampened_layers: string[];
  layer_multipliers: Record<string, number>;
  reason: string;
};

function strOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t || null;
}

export function parseMarketContextFlags(body: Record<string, unknown> | null | undefined): MarketContextFlags | null {
  if (!body || typeof body !== "object") return null;
  const raw = body.market_context_flags;
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const warningsRaw = o.warnings;
  const warnings = Array.isArray(warningsRaw)
    ? warningsRaw.map((w) => String(w).trim()).filter(Boolean)
    : [];
  const listed =
    typeof o.listed_days === "number" && Number.isFinite(o.listed_days) ? Math.round(o.listed_days) : null;
  const flags: MarketContextFlags = {
    ipo_unseasoned: Boolean(o.ipo_unseasoned),
    index_inclusion_window: Boolean(o.index_inclusion_window),
    listed_days: listed,
    ecosystem_entity: strOrNull(o.ecosystem_entity),
    ecosystem_role: strOrNull(o.ecosystem_role),
    warnings
  };
  if (
    !flags.ipo_unseasoned &&
    !flags.index_inclusion_window &&
    !flags.ecosystem_entity &&
    flags.warnings.length === 0
  ) {
    return null;
  }
  return flags;
}

export function parseMarketContextDampening(
  body: Record<string, unknown> | null | undefined
): MarketContextDampening | null {
  if (!body || typeof body !== "object") return null;
  const raw = body.market_context_dampening;
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const layersRaw = o.dampened_layers;
  const dampened_layers = Array.isArray(layersRaw)
    ? layersRaw.map((x) => String(x).trim()).filter(Boolean)
    : [];
  const multRaw = o.layer_multipliers;
  const layer_multipliers: Record<string, number> = {};
  if (multRaw && typeof multRaw === "object") {
    for (const [k, v] of Object.entries(multRaw as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) layer_multipliers[k] = v;
    }
  }
  const reason = typeof o.reason === "string" ? o.reason.trim() : "";
  if (!dampened_layers.length && !reason) return null;
  return { dampened_layers, layer_multipliers, reason };
}

export function marketContextHeadline(flags: MarketContextFlags): string {
  if (flags.ipo_unseasoned) return "New listing — treat volume and gaps with caution";
  if (flags.index_inclusion_window) return "Index inclusion window — mechanical flows may distort reads";
  if (flags.ecosystem_entity) return `IPO ecosystem exposure — ${flags.ecosystem_entity}`;
  return "Market structure caveat";
}

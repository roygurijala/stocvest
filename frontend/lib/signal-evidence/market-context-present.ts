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

export type MarketContextDampenedLayer = {
  layer: string;
  multiplier: number;
  original_contribution: number;
  adjusted_contribution: number;
};

export type MarketContextDampening = {
  active: boolean;
  reason: string;
  trigger: string | null;
  window_end: string | null;
  confidence_level: string;
  undampened_score: number;
  adjusted_score: number;
  dampened_layers: MarketContextDampenedLayer[];
  /** Back-compat flat map */
  layer_multipliers?: Record<string, number>;
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
  let dampened_layers: MarketContextDampenedLayer[] = [];
  if (Array.isArray(layersRaw)) {
    dampened_layers = layersRaw
      .map((row) => {
        if (!row || typeof row !== "object") return null;
        const r = row as Record<string, unknown>;
        const layer = strOrNull(r.layer);
        const mult = typeof r.multiplier === "number" ? r.multiplier : null;
        const orig = typeof r.original_contribution === "number" ? r.original_contribution : null;
        const adj = typeof r.adjusted_contribution === "number" ? r.adjusted_contribution : null;
        if (!layer || mult == null || orig == null || adj == null) return null;
        return {
          layer,
          multiplier: mult,
          original_contribution: orig,
          adjusted_contribution: adj
        };
      })
      .filter((x): x is MarketContextDampenedLayer => x != null);
  }

  // Legacy shape: dampened_layers was string[] + layer_multipliers map
  if (!dampened_layers.length && Array.isArray(layersRaw)) {
    const multRaw = o.layer_multipliers;
    if (multRaw && typeof multRaw === "object") {
      dampened_layers = Object.entries(multRaw as Record<string, unknown>)
        .map(([layer, mult]) =>
          typeof mult === "number"
            ? { layer, multiplier: mult, original_contribution: 0, adjusted_contribution: 0 }
            : null
        )
        .filter((x): x is MarketContextDampenedLayer => x != null);
    }
  }

  const undampened =
    typeof o.undampened_score === "number" && Number.isFinite(o.undampened_score)
      ? Math.round(o.undampened_score)
      : null;
  const adjusted =
    typeof o.adjusted_score === "number" && Number.isFinite(o.adjusted_score)
      ? Math.round(o.adjusted_score)
      : null;

  if (!dampened_layers.length && undampened == null && adjusted == null) return null;

  return {
    active: o.active !== false,
    reason: strOrNull(o.reason) ?? "market_context",
    trigger: strOrNull(o.trigger),
    window_end: strOrNull(o.window_end),
    confidence_level: strOrNull(o.confidence_level) ?? "reduced",
    undampened_score: undampened ?? adjusted ?? 0,
    adjusted_score: adjusted ?? undampened ?? 0,
    dampened_layers,
    layer_multipliers:
      o.layer_multipliers && typeof o.layer_multipliers === "object"
        ? (o.layer_multipliers as Record<string, number>)
        : undefined
  };
}

export function marketContextHeadline(flags: MarketContextFlags): string {
  if (flags.ipo_unseasoned) return "New listing — treat volume and gaps with caution";
  if (flags.index_inclusion_window) return "Index inclusion window — mechanical flows may distort reads";
  if (flags.ecosystem_entity) return `IPO ecosystem exposure — ${flags.ecosystem_entity}`;
  return "Market structure caveat";
}

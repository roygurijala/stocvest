/**
 * Map composite API payloads → Signals layer rows (shared by Signals page + Scenario Builder).
 */

import { isInsufficientCompositeResponse } from "@/lib/api/swing-composite";
import { signalLayerDisplayName } from "@/lib/signals/layer-display-names";
import { normalizeSetupBias, type SignalsLayerRowInput, type SignalsSetupBias } from "@/lib/signals-page-present";

export const COMPOSITE_LAYER_KEYS = [
  "technical",
  "news",
  "macro",
  "sector",
  "geopolitical",
  "internals"
] as const;

type LayerStatus =
  | "Bullish"
  | "Bearish"
  | "Neutral"
  | "Unavailable"
  | "As of close";

/** Sector benchmark line for Signals layer rows and Evidence (RKLB → ITA / display name). */
export function sectorLayerStatusLabelFromEntry(
  entry: Record<string, unknown> | undefined
): { statusLabel?: string; sectorCachePending?: boolean } {
  const sectorCachePending =
    String(entry?.sector_resolution_state ?? "") === "pending_cache_refresh";
  const sectorEtf = typeof entry?.sector_etf === "string" ? entry.sector_etf.trim().toUpperCase() : "";
  const sectorDisplay =
    typeof entry?.sector_display_name === "string" ? entry.sector_display_name.trim() : "";
  const benchmark =
    sectorDisplay && sectorEtf
      ? `${sectorDisplay} (${sectorEtf})`
      : sectorEtf || sectorDisplay || "";

  if (sectorCachePending) {
    if (benchmark) {
      return { statusLabel: `${benchmark} · resolving`, sectorCachePending: true };
    }
    return { statusLabel: "Unavailable (not factored)", sectorCachePending: true };
  }
  if (benchmark) {
    return { statusLabel: benchmark };
  }
  return {};
}

function strField(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function numField(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function layerMetadataFromEntry(
  key: string,
  entry: Record<string, unknown>
): Partial<SignalsLayerRowInput> {
  const meta: Partial<SignalsLayerRowInput> = {};
  const chips = Array.isArray(entry.chips)
    ? entry.chips.map((c) => String(c)).filter((c) => c.trim().length > 0)
    : [];
  if (chips.length > 0) meta.chips = chips;

  const verdict = strField(entry.verdict);
  if (verdict) meta.verdict = verdict;

  if (key === "technical") {
    meta.vwapState = strField(entry.vwap_state) || null;
    const tooltip = strField(entry.vwap_state_tooltip ?? entry.vwap_tooltip);
    if (tooltip) meta.vwapStateTooltip = tooltip;
  }

  if (key === "news") {
    const ac = numField(entry.article_count ?? entry.articles_count);
    if (ac != null) meta.articleCount = Math.round(ac);
    meta.headlineSentiment = numField(entry.headline_sentiment);
    const wim = strField(entry.wim_summary);
    if (wim) meta.wimSummary = wim;
    const lr = entry.latest_rating;
    if (lr && typeof lr === "object") {
      const o = lr as Record<string, unknown>;
      const parts = [o.action, o.rating, o.firm].map((x) => strField(x)).filter(Boolean);
      if (parts.length) meta.latestRating = parts.join(" · ");
    }
    const acRaw = entry.analyst_consensus;
    if (acRaw && typeof acRaw === "object") {
      const c = acRaw as Record<string, unknown>;
      const label = strField(c.label);
      if (label) meta.analystConsensus = label;
    }
    const er = entry.earnings_result;
    if (er && typeof er === "object") {
      const e = er as Record<string, unknown>;
      const beat = e.beat === true ? "beat" : e.beat === false ? "miss" : "";
      const period = strField(e.period);
      meta.earningsResult = [beat, period].filter(Boolean).join(" · ") || null;
    }
  }

  if (key === "macro") {
    const mw = entry.macro_warnings;
    if (Array.isArray(mw)) {
      meta.macroWarnings = mw.map((x) => String(x)).filter((s) => s.trim().length > 0);
    }
    const ue = entry.upcoming_events;
    if (Array.isArray(ue)) {
      meta.upcomingEvents = ue
        .filter((item) => item && typeof item === "object")
        .map((item) => {
          const o = item as Record<string, unknown>;
          return {
            event: strField(o.name ?? o.event),
            date: strField(o.scheduled_time ?? o.date),
            impact: strField(o.warning ?? o.importance) || undefined
          };
        })
        .filter((row) => row.event.length > 0);
    }
    const yc = entry.yield_curve;
    if (yc && typeof yc === "object") {
      const y = yc as Record<string, unknown>;
      meta.yieldCurve = {
        status: strField(y.regime ?? y.label) || "unknown",
        signal: strField(y.chip ?? y.label) || ""
      };
    }
  }

  if (key === "geopolitical") {
    const events = entry.geo_active_events ?? entry.active_events;
    if (Array.isArray(events)) {
      meta.geoActiveEvents = events
        .filter((item) => item && typeof item === "object")
        .map((item) => {
          const o = item as Record<string, unknown>;
          return {
            title: strField(o.title ?? o.name),
            severity: strField(o.severity ?? o.level) || "medium"
          };
        })
        .filter((row) => row.title.length > 0);
    }
    meta.geoExposureSummary = strField(entry.geo_exposure_summary) || null;
    meta.geoExposureBand = strField(entry.geo_exposure_band) || null;
    meta.geoPrimaryTheme = strField(entry.geo_primary_theme) || null;
  }

  if (key === "sector") {
    meta.sectorEtf = strField(entry.sector_etf) || null;
    meta.sectorDisplayName = strField(entry.sector_display_name) || null;
    meta.sectorMomentum = numField(entry.sector_momentum ?? entry.sector_persistence);
    meta.vsSectorPerformance = numField(entry.vs_sector_performance ?? entry.relative_strength);
  }

  return meta;
}

function verdictToLayerStatus(verdict: string, status: string): LayerStatus {
  const s = status.toLowerCase();
  if (s === "as_of_close") {
    return "As of close";
  }
  if (s === "unavailable") {
    const v = verdict.toLowerCase();
    if (v === "bullish" || v === "bearish" || v === "neutral") {
      return "As of close";
    }
    return "Unavailable";
  }
  const v = verdict.toLowerCase();
  if (v === "bullish") return "Bullish";
  if (v === "bearish") return "Bearish";
  return "Neutral";
}

export function compositeToSignalsLayerRows(
  composite: Record<string, unknown> | null | undefined
): SignalsLayerRowInput[] {
  if (!composite || isInsufficientCompositeResponse(composite)) return [];
  const rawLayers = composite.layers;
  if (!Array.isArray(rawLayers)) return [];
  return COMPOSITE_LAYER_KEYS.map((key) => {
    const entry = (rawLayers as Array<Record<string, unknown>>).find(
      (x) => String(x.layer ?? "").toLowerCase() === key
    );
    const st = typeof entry?.status === "string" ? entry.status : "unavailable";
    const rawScore = typeof entry?.score === "number" && Number.isFinite(entry.score) ? entry.score : null;
    const score = rawScore != null ? Math.max(0, Math.min(100, Math.round(rawScore))) : null;
    const verdict = typeof entry?.verdict === "string" ? entry.verdict : "neutral";
    const apiStatus = st.toLowerCase();
    const asOfClose = apiStatus === "as_of_close";
    const sectorMeta = key === "sector" ? sectorLayerStatusLabelFromEntry(entry) : {};
    const sectorCachePending = Boolean(sectorMeta.sectorCachePending);
    const status = sectorCachePending
      ? "Unavailable"
      : asOfClose
        ? verdictToLayerStatus(verdict, "available")
        : verdictToLayerStatus(verdict, st);
    const reasoning =
      typeof entry?.reasoning === "string" && entry.reasoning.trim()
        ? entry.reasoning.trim()
        : typeof entry?.explanation === "string" && entry.explanation.trim()
          ? entry.explanation.trim()
          : "";
    return {
      key,
      name: signalLayerDisplayName(key),
      status,
      statusLabel:
        sectorMeta.statusLabel ??
        (asOfClose ? "As of close · daily structure" : undefined),
      explanation: reasoning,
      reasoning: reasoning || undefined,
      score,
      sectorCachePending: sectorMeta.sectorCachePending,
      ...layerMetadataFromEntry(key, entry ?? {})
    };
  });
}

export function deriveSetupBiasFromComposite(
  composite: Record<string, unknown> | null | undefined,
  layerRows: SignalsLayerRowInput[]
): SignalsSetupBias {
  if (composite && !isInsufficientCompositeResponse(composite)) {
    if (typeof composite.signal_summary === "string") {
      const s = String(composite.signal_summary);
      return normalizeSetupBias(s.charAt(0).toUpperCase() + s.slice(1).toLowerCase());
    }
  }
  if (layerRows.length === 0) return "Neutral";
  const scored = layerRows.map((r) => r.score).filter((s): s is number => s != null);
  if (scored.length === 0) return "Neutral";
  const avg = scored.reduce((sum, s) => sum + s, 0) / scored.length;
  return avg >= 58 ? "Bullish" : avg <= 42 ? "Bearish" : "Neutral";
}

export function maturationBiasToSetupBias(bias: string | null | undefined): SignalsSetupBias | null {
  const b = (bias ?? "").trim().toLowerCase();
  if (b === "long" || b === "bullish") return "Bullish";
  if (b === "short" || b === "bearish") return "Bearish";
  if (b === "neutral") return "Neutral";
  return null;
}

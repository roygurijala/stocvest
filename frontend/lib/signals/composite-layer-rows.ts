/**
 * Map composite API payloads → Signals layer rows (shared by Signals page + Scenario Builder).
 */

import { isInsufficientCompositeResponse } from "@/lib/api/swing-composite";
import { catalystArticlesForNewsLayer } from "@/lib/signals/layer-catalyst-articles";
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
    const snap = entry.indicator_snapshot;
    if (snap && typeof snap === "object") {
      meta.indicatorSnapshot = snap as Record<string, string | number | boolean | null>;
    }
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
    const lg = entry.latest_guidance;
    if (lg && typeof lg === "object") {
      const headline = strField((lg as Record<string, unknown>).headline);
      if (headline) meta.latestGuidance = headline;
    }
    const rr = entry.recent_ratings;
    if (Array.isArray(rr)) {
      meta.recentRatings = rr
        .filter((item) => item && typeof item === "object")
        .map((item) => {
          const o = item as Record<string, unknown>;
          return {
            action: strField(o.action),
            rating: strField(o.rating),
            firm: strField(o.firm),
            date: strField(o.date ?? o.date_str),
            priceTarget: numField(o.price_target)
          };
        })
        .filter((row) => row.firm.length > 0 || row.action.length > 0);
    }
  }

  if (key === "macro") {
    meta.macroRiskLevel = strField(entry.macro_risk_level) || null;
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
    meta.sectorInterpretation = strField(entry.sector_interpretation) || null;
    meta.sectorTrending = strField(entry.sector_trending) || null;
    meta.sectorRank1d = numField(entry.sector_rank_1d);
    meta.sectorRank5d = numField(entry.sector_rank_5d);
    const sessions = entry.sector_daily_sessions;
    if (Array.isArray(sessions)) {
      meta.sectorDailySessions = sessions
        .filter((item) => item && typeof item === "object")
        .map((item) => {
          const o = item as Record<string, unknown>;
          return {
            date: strField(o.date),
            etfPct: numField(o.etf_pct) ?? 0,
            spyPct: numField(o.spy_pct) ?? 0,
            relative: numField(o.relative) ?? 0,
            outperformed: o.outperformed === true
          };
        })
        .filter((row) => row.date.length > 0)
        .slice(0, 5);
    }
  }

  if (key === "internals") {
    meta.breadthSignal = strField(entry.breadth_signal) || null;
    meta.participationSignal = strField(entry.participation) || null;
  }

  return meta;
}

function verdictToLayerStatus(verdict: string, status: string): LayerStatus {
  const s = status.toLowerCase();
  if (s === "degraded") {
    return "Unavailable";
  }
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

/**
 * Attach the B71 per-symbol News/Geo sensitivity (top-level `news_geo_sensitivity`)
 * onto the matching layer rows so the deep-dive can show what weighting a stock gets.
 */
function applyNewsGeoSensitivity(
  rows: SignalsLayerRowInput[],
  sensitivity: unknown
): void {
  if (!sensitivity || typeof sensitivity !== "object") return;
  const s = sensitivity as Record<string, unknown>;
  const apply = (rowKey: "news" | "geopolitical", payloadKey: string) => {
    const obj = s[payloadKey];
    if (!obj || typeof obj !== "object") return;
    const o = obj as Record<string, unknown>;
    const band = strField(o.band);
    if (!band) return;
    const row = rows.find((r) => r.key === rowKey);
    if (!row) return;
    row.sensitivityBand = band;
    row.sensitivityMultiplier = numField(o.multiplier);
  };
  apply("news", "news");
  apply("geopolitical", "geopolitical");
}

/**
 * Attach the B72 per-symbol sector technical calibration (top-level
 * `sector_technical_calibration`) onto the Technical layer row so the deep-dive
 * can show what sector volatility regime is calibrating this stock's technicals.
 */
function applySectorTechnicalCalibration(
  rows: SignalsLayerRowInput[],
  calibration: unknown
): void {
  if (!calibration || typeof calibration !== "object") return;
  const c = calibration as Record<string, unknown>;
  const regime = strField(c.regime);
  if (!regime) return;
  const row = rows.find((r) => r.key === "technical");
  if (!row) return;
  row.techVolRegime = regime;
  row.techRvolMultiplier = numField(c.rvol_threshold_multiplier);
  row.techOverboughtMultiplier = numField(c.overbought_penalty_multiplier);
}

export function compositeToSignalsLayerRows(
  composite: Record<string, unknown> | null | undefined
): SignalsLayerRowInput[] {
  if (!composite || isInsufficientCompositeResponse(composite)) return [];
  const rawLayers = composite.layers;
  if (!Array.isArray(rawLayers)) return [];
  const rows = COMPOSITE_LAYER_KEYS.map((key) => {
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

  const newsEntry = (rawLayers as Array<Record<string, unknown>> | undefined)?.find(
    (x) => String(x.layer ?? "").toLowerCase() === "news"
  );
  const catalystArticles = catalystArticlesForNewsLayer(newsEntry, composite);
  if (catalystArticles.length > 0) {
    const news = rows.find((r) => r.key === "news");
    if (news) {
      news.catalystArticles = catalystArticles;
    }
  }

  applyNewsGeoSensitivity(rows, composite.news_geo_sensitivity);
  applySectorTechnicalCalibration(rows, composite.sector_technical_calibration);

  return rows;
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

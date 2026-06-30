/**
 * Wire-type contracts for the signal evidence card.
 *
 * Pure type declarations split out of `signal-evidence.ts` (which re-exports
 * them). No runtime code — moving these is type-only and verified by the build.
 */

export type EvidenceDirection = "bullish" | "bearish" | "neutral";
export type EvidenceStatus = "Bullish" | "Bearish" | "Neutral" | "Unavailable" | "As of close";

export type SignalEvidenceFundamentalContext = {
  backdrop: "positive" | "neutral" | "mixed" | "weak";
  earnings_trend: "beating" | "missing" | "inline" | "unknown";
  guidance_direction: "raised" | "lowered" | "maintained" | "unknown";
  analyst_direction: "upgrading" | "downgrading" | "stable" | "unknown";
  revenue_trend: "growing" | "flat" | "declining" | "unknown";
  summary_line: string;
  data_quality: "high" | "medium" | "low";
  quarters_beating: number;
  quarters_missing: number;
  recent_upgrades: number;
  recent_downgrades: number;
  sector_display_name?: string | null;
  sector_etf?: string | null;
};

/** Per-theme sector multiplier row from composite `layers[].geo_event_details`. */
export interface GeoEventDetailRow {
  event_type: string;
  score: number;
  sector_multiplier: number | null;
}

/** Structured geopolitical exposure (real/swing composite) for the evidence card. */
export interface GeopoliticalLayerExtras {
  impactSectorKey: string;
  impactSectorLabel: string;
  stockExposureScore: number | null;
  exposureBand: "low" | "moderate" | "high" | null;
  exposureSummary: string | null;
  activeEvents: Array<{ event_type: string; score: number }>;
  eventDetails: GeoEventDetailRow[];
  /** Structural baseline (risk / sensitivity scale) — always present once geo layer is hydrated. */
  geoBaselineScore?: number;
  geoBaselineSummary?: string;
  /** True when headlineKeyword events augmented the geo read; false = structural baseline only. */
  geoHasLiveEvents?: boolean;
  geoPrimaryTheme?: string | null;
}

export interface NewsLayerRating {
  action: string;
  rating: string;
  firm: string;
  /** ISO date string (`YYYY-MM-DD`) */
  date: string;
  price_target?: number | null;
  upside_pct?: number | null;
  firm_tier?: "tier_1" | "standard" | string;
}

export interface NewsLayerAnalystConsensus {
  upgrades_30d: number;
  downgrades_30d: number;
  momentum: number;
  label?: string | null;
  unique_firms?: boolean;
}

export interface NewsLayerGuidance {
  type: string;
  headline: string;
  /** ISO date string (`YYYY-MM-DD`) */
  date: string;
}

export interface NewsLayerEarningsResult {
  beat: boolean | null;
  eps_surprise_pct: number | null;
  period: string;
}

/** Macro calendar / FRED extras from composite `layers[].macro` row. */
export interface MacroUpcomingEventWire {
  event_id: string;
  name: string;
  category: string;
  status: string;
  importance: number;
  hours_until: number;
  warning: string | null;
  scheduled_time: string;
}

export interface MacroYieldCurveWire {
  yield_2yr: number;
  yield_10yr: number;
  spread: number;
  regime: "normal" | "flat" | "inverted";
  label: string;
  chip: string;
}

/** Sector mapper / cache resolution (composite `layers[].sector_resolution_state`). */
export type SectorResolutionStateWire = "resolved" | "pending_cache_refresh" | "unmapped";

/** Redis-backed daily ETF vs SPY session row when API includes `sector_daily_sessions`. */
export interface SectorDailySessionWire {
  date: string;
  etf_pct: number;
  spy_pct: number;
  relative: number;
  outperformed: boolean;
  volume_ratio: number;
}

/** Macro-sector-technical synthesis from composite top-level `alignment` (additive). */
export type CompositeAlignmentLevelWire = "full" | "strong" | "moderate" | "weak" | "conflict";

export interface CompositeAlignmentWire {
  level: CompositeAlignmentLevelWire;
  score_modifier: number;
  label: string;
  detail: string;
  chip: string;
  is_tailwind: boolean;
  is_headwind: boolean;
  is_counter_trend: boolean;
  macro_direction: string;
  sector_direction: string;
  technical_direction: string;
  macro_supports: boolean;
  sector_supports: boolean;
  technical_supports: boolean;
}

export interface EvidenceLayer {
  key: string;
  icon: string;
  name: string;
  status: EvidenceStatus;
  weightPercent: number;
  explanation: string;
  keyPoints: string[];
  contributionScore: number | null;
  freshnessLabel: string;
  macro_warnings?: string[];
  macro_risk_level?: "low" | "moderate" | "elevated" | "critical";
  upcoming_events?: MacroUpcomingEventWire[];
  yield_curve?: MacroYieldCurveWire | null;
  /** Present when API returns geo sector mapping + themes (geopolitical layer only). */
  geo?: GeopoliticalLayerExtras;
  /** Composite news layer extras (when BFF merges `layers[].news`). */
  wim_summary?: string;
  articles_count?: number;
  news_data_state?: string;
  analyst_feed_state?: "available" | "unconfigured" | "empty" | string;
  headline_sentiment?: number | null;
  analyst_sub_score?: number | null;
  latest_rating?: NewsLayerRating;
  latest_guidance?: NewsLayerGuidance;
  earnings_result?: NewsLayerEarningsResult;
  analyst_consensus?: NewsLayerAnalystConsensus;
  /** Sector layer momentum + resolver state (composite real/swing APIs). */
  sector_resolution_state?: SectorResolutionStateWire | null;
  sector_persistence?: number | null;
  sector_sessions_leading?: number | null;
  sector_total_sessions?: number | null;
  sector_trending?: string | null;
  sector_rank_1d?: number | null;
  sector_rank_5d?: number | null;
  sector_interpretation?: string | null;
  sector_data_available?: boolean | null;
  sector_daily_sessions?: SectorDailySessionWire[];
  sector_etf?: string | null;
  sector_display_name?: string | null;
  sector_bucket?: string | null;
}

export interface SignalEvidenceConfluence {
  confluence_score: number;
  confluence_tier: string;
  is_confluence_alert: boolean;
  confirming_signals: Array<{ label: string; detail?: string; source?: string }>;
  conflicting_signals: Array<{ label: string; detail?: string; source?: string }>;
  n_confirming: number;
  n_conflicting: number;
  historical_note: string;
  confluence_disclaimer: string;
}

/** Actionable insight block (swing composite API + deterministic fallbacks). Not investment advice. */
export interface SignalEvidenceInsight {
  signal_score: number;
  trend_strength: string;
  trend_direction: string;
  /** B79 — how much to trust the bullish/bearish direction (High/Moderate/Low). */
  direction_confidence?: "High" | "Moderate" | "Low";
  direction_confidence_score?: number;
  direction_confidence_reason?: string;
  risk_reward: number;
  rr_warning?: boolean;
  rr_quality?: "low" | "acceptable" | "good" | "strong";
  market_regime: string;
  confirming_signals: Array<{ label: string; detail?: string; source?: string }>;
  conflicting_signals: Array<{ label: string; detail?: string; source?: string }>;
  catalysts: Array<{ text: string; sentiment: string; source?: string; published_at?: string; sentiment_score?: number }>;
  risk_factors: string[];
  risk_factors_detailed?: Array<{ label: string; severity: "high" | "medium" | "low"; detail: string }>;
  signal_parameters: string;
  historical_entry_zone: { low: number; high: number } | null;
  session_entry_zone?: { low: number; high: number } | null;
  /** Validation state: clean | clamped | no_clean_entry */
  entry_zone_quality?: string | null;
  entry_zone_worst_case_rr?: number | null;
  /** Pullback vs breakout geometry */
  entry_style?: "pullback" | "breakout" | null;
  entry_anchor?: number | null;
  entry_distance_atr?: number | null;
  zone_width_atr?: number | null;
  entry_distance_tier?: "ideal" | "acceptable" | "chasing" | null;
  entry_quality_tier?: "high" | "medium" | "low" | null;
  /** Symmetric band around anchor — display as ideal pullback, not primary entry */
  ideal_pullback_zone?: { low: number; high: number } | null;
  swing_range_zone?: { low: number; high: number; sessions?: number } | null;
  reference_target_1: number | null;
  reference_target_2: number | null;
  reference_target_2_provenance?: string | null;
  reference_stop_level: number | null;
  reference_stop_provenance?: string | null;
  reference_target_provenance?: string | null;
  /** ATR14 from technical layer when composite exposes it. */
  atr?: number | null;
  /** Session VWAP when available; modal uses this before `keyLevels.vwap`. */
  vwap: number | null;
  vwap_state?: string;
  vwap_display?: string;
  vwap_tooltip?: string;
  is_complete?: boolean;
  missing_fields?: string[];
  alignment_ratio?: number;
  conflicted_layers?: string[];
  /** Standing analyst price targets — informational (assistant / fundamental context), not used for T2 geometry. */
  analyst_target_levels?: number[];
  analyst_target_source?: "benzinga" | "perplexity" | "none";
}

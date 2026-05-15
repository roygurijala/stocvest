/**
 * Shared types for the STOCVEST Assistant chatbot.
 *
 * The server holds the locked system prompt; the client only sends conversation turns
 * and an optional whitelisted page context. Keep this surface narrow on purpose.
 */

/** Signal layer keys used by the Layers / Evidence views. Kept in lockstep with the backend. */
export type AssistantLayerKey =
  | "technical"
  | "news"
  | "macro"
  | "sector"
  | "geopolitical"
  | "internals";

export type AssistantLayerStatus =
  | "Bullish"
  | "Bearish"
  | "Neutral"
  | "Unavailable"
  | "As of close";

export type AssistantDecisionState = "actionable" | "monitor" | "blocked";

export interface AssistantDecisionRationale {
  /** Backend rationale category — five fixed values defined by the Decision rationale spec. */
  category: "data_insufficient" | "risk_reward" | "confirmation" | "regime" | "readiness";
  /** State-aware short label ("Why hold:" or "Why blocked:"). */
  label: string;
  /** Single declarative sentence shown beside the Decision line. */
  text: string;
}

/** Qualitative summary of one ranked setup row, as it appears on the scanner. */
export interface AssistantScannerSetupSummary {
  symbol: string;
  /** Long / short flavor as displayed by the row's direction chip. */
  direction: "long" | "short";
  /**
   * Bucketed setup strength derived from the displayed strength percent — kept qualitative on
   * purpose ("strong" / "moderate" / "weak") so the assistant never quotes a raw score.
   */
  strength_bucket: "strong" | "moderate" | "weak";
  confluence: boolean;
  /** True for ORB-flavored setups after 10:00 AM ET when the row is greyed out. */
  orb_expired: boolean;
}

/** Qualitative summary of one Gap Intelligence row with a confirmed catalyst. */
export interface AssistantScannerGapSummary {
  symbol: string;
  gap_direction: "up" | "down";
  quality_bucket: "high" | "medium" | "low";
  /** Headline catalyst category as displayed (e.g. "earnings", "guidance"). */
  catalyst_category?: string;
  catalyst_sentiment?: "bullish" | "bearish" | "neutral";
}

/**
 * Page context the Assistant is allowed to see. Only fields enumerated here are forwarded
 * to the backend; unknown keys are dropped server-side as well.
 */
export interface AssistantPageContext {
  /** Page identifier, e.g. "signals/layers", "signals/history", or "dashboard/scanner". */
  page: string;
  /** Active trading mode if the page exposes one. */
  trading_mode?: "swing" | "day";
  symbol?: string;
  decision_state?: AssistantDecisionState;
  decision_line?: string;
  decision_rationale?: AssistantDecisionRationale;
  trade_readiness?: number | null;
  risk_reward?: number | null;
  trend_strength?: string;
  trend_direction?: string;
  market_regime?: string;
  layer_alignment_pct?: number | null;
  layer_status?: Partial<Record<AssistantLayerKey, AssistantLayerStatus>>;
  /**
   * High-level status of the analysis on the current page. Lets the assistant distinguish
   * "decision visible on screen" from "user has selected a symbol but no analysis loaded yet".
   * Omit when the page does not run an analysis (e.g. Signal State History).
   */
  analysis_status?: "loaded" | "loading" | "unavailable" | "insufficient_data";

  // Scanner-overview fields (multi-symbol summary page). All optional — only set on scanner.
  /** Scanner's setup-source selector, preserved verbatim (supports "both" which `trading_mode` cannot). */
  scanner_focus?: "swing" | "day" | "both";
  /** True during US regular session hours, false outside (matches the "Market closed" label). */
  market_open?: boolean;
  gap_with_catalyst_count?: number;
  gap_without_catalyst_count?: number;
  ranked_setups_count?: number;
  /** Top setups currently visible to the user (capped at 3, qualitative). */
  top_setups?: AssistantScannerSetupSummary[];
  /** Top catalyst-confirmed gaps currently visible to the user (capped at 3, qualitative). */
  top_gaps_with_catalyst?: AssistantScannerGapSummary[];
  /** True when the swing-context banner is showing (no ranked swing setups but gaps exist). */
  swing_setups_suppressed?: boolean;
  /** The single calm one-liner shown to the user when the setups list is empty. */
  setups_empty_message?: string;

  // ────────────────────────────────────────────────────────────────────────────
  // Mode Separation B28 (Phase 1) — dual-desk dashboard posture.
  //
  // These two fields appear together on the dashboard page-context only.
  // Their joint presence is the signal to the LLM that the active surface is a
  // dual-desk view (Swing Desk + Day Desk both visible) — the trigger for the
  // PRIORITY 3 STRUCTURED DUAL ANSWER routing path codified in
  // ASSISTANT_SYSTEM_PROMPT. `trading_mode` is deliberately OMITTED on the
  // dashboard so the LLM does not inherit a single mode via Priority 1.
  // ────────────────────────────────────────────────────────────────────────────

  /** Posture of the Swing Desk panel on the dashboard. Mirrors the visible pill state. */
  swing_desk_posture?: "active" | "monitor" | "suppressed";
  /** Posture of the Day Desk panel on the dashboard. Mirrors the visible pill state.
   *  The two suppressed variants distinguish session-closed (no intraday gates can fire)
   *  from in-session no-confirmation (gates available but not cleared). */
  day_desk_posture?:
    | "active"
    | "monitor"
    | "suppressed_session_closed"
    | "suppressed_no_confirmation"
    | "suppressed_scanner_error";
  /** Number of intraday setups visible on the dashboard's Day Desk (cap respected). */
  day_setups_count?: number;

  /**
   * Tier 1.C Phase 4 — nested dashboard surface summary (version 1).
   * Stable keys: regime, discovery, universe, desk postures, top_setups,
   * optional gap_leaders_detail when discovery is expanded, macro_events.
   */
  dashboard_context?: DashboardAssistantContextV1;

  /**
   * Server-shaped Gap Intelligence snapshot subset (Signals page). The
   * backend serializer only forwards these keys to the assistant.
   */
  gap_intel?: AssistantGapIntel;
}

/** Versioned dashboard assistant block — keep in lockstep with `serialize_page_context`. */
export type DashboardAssistantContextV1 = {
  version: 1;
  regime: string;
  discovery: {
    leader_count: number;
    with_catalyst_count: number;
    preview_symbols: string[];
  };
  universe: {
    swing_universe_symbol_count: number | null;
    gap_snapshot_symbol_count: number | null;
  };
  swing_desk_posture: "active" | "monitor" | "suppressed";
  day_desk_posture?:
    | "active"
    | "monitor"
    | "suppressed_session_closed"
    | "suppressed_no_confirmation"
    | "suppressed_scanner_error";
  top_setups: AssistantScannerSetupSummary[];
  gap_leaders_detail?: AssistantScannerGapSummary[];
  macro_events: Array<{
    symbol: string;
    report_date: string;
    report_time: "before_market" | "after_market" | "during_market" | "unknown";
  }>;
};

/** Keys whitelisted for assistant serialization — nested object from gap-intel API. */
export interface AssistantGapIntel {
  phase: { state?: string; label?: string };
  gap: { direction?: string; status?: string; resolution_state?: string };
  levels: {
    fill_level?: number | null;
    fill_source?: string;
    fill_reliability?: string;
  };
  liquidity: { is_high_liquidity?: boolean };
  scenario_builder: { state?: string; reasons?: string[] };
  flags: { calendar_state?: string; stale?: boolean };
}

export type AssistantMessageRole = "user" | "assistant";

export interface AssistantMessage {
  id: string;
  role: AssistantMessageRole;
  content: string;
  /** True while the assistant turn is still being fetched from the server. */
  pending?: boolean;
  /** Server-reported mode at the time the assistant turn was generated. */
  mode?: "general" | "contextual";
  /** Drives the word-fade reveal animation only for the most recent assistant turn. */
  fresh?: boolean;
}

export interface AssistantChatResponse {
  text: string;
  source: "ai" | "deterministic";
  mode: "general" | "contextual";
  upgrade_available: boolean;
  disclaimer?: string;
}

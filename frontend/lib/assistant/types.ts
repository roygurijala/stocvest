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

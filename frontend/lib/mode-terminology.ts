/**
 * Mode terminology — the single source of truth for every user-visible
 * label that names a trading mode (Swing / Day).
 *
 * **Why this file exists**
 *
 * Over time the codebase accumulated drift: tab labels said `"Day"`, the
 * Performance page said `"day trades"`, the Day Desk said `"DAY ·
 * INTRADAY"`, marketing copy said `"day trading"`, and PDT widgets said
 * `"day trade(s)"`. Some of those are *correct* (PDT is an SEC term of
 * art that REQUIRES "day trades"), some are *equivalent* (the marketing
 * copy is fine), and one was *wrong* (Performance shouldn't say "trades"
 * — STOCVEST tracks SIGNALS, not trades).
 *
 * This module pins the canonical label per UI surface so future
 * additions don't have to re-decide. The Mode Separation rules in
 * `ASSISTANT_SYSTEM_PROMPT` already declare "Swing and Day are
 * independent decision engines"; this is the UI-layer mirror of that
 * contract.
 *
 * **The contract (closed-set, do not extend without tests)**
 *
 * | Surface                          | Label             |
 * |----------------------------------|-------------------|
 * | Tab / pill / chip (compact)      | `Swing` / `Day`   |
 * | Section / desk heading           | `Swing Desk` / `Day Desk` |
 * | Cadence-qualified subheading     | `Swing (multi-day)` / `Day (intraday)` |
 * | Explanatory prose                | `swing trading (multi-day)` / `day trading (intraday)` |
 * | Outcome tracking (signals, not trades) | `swing signals` / `day signals` |
 * | Internal mode string             | `"swing"` / `"day"` (lowercase, programmatic only) |
 *
 * **What is NOT in scope here**
 *
 * 1. PDT terminology (`"day trade"`, `"day trades"`, `"Pattern Day
 *    Trader"`) — this is a regulatory term of art. The SEC and FINRA
 *    documents both use `"day trade"` as a noun (a discrete event:
 *    open + close same session) and `"day trades"` as a countable
 *    count. The PDT widget, the order-confirmation PDT pill, and the
 *    settings "When 2 of 3 day trades are used" copy MUST keep that
 *    wording. They are NOT a Mode label.
 *
 * 2. Marketing taglines and educational prose — `"swing trading"` /
 *    `"day trading"` as gerunds describing an activity (vs. "Swing" /
 *    "Day" as a mode label) are correct English and don't need to
 *    pull from this module. The contract above lists when each form is
 *    appropriate.
 */

/**
 * Closed-set type for the two trading modes. Use this everywhere
 * instead of inline `"swing" | "day"` so a future rename (e.g. adding
 * a third mode) is a one-line refactor.
 */
export type TradingMode = "swing" | "day";

/**
 * Closed-set type for the scanner's three-way toggle. `"both"` is
 * UI-only — it's the merged-render view, never an engine mode.
 */
export type ScannerMode = TradingMode | "both";

// ── TAB / PILL / CHIP LABELS (compact) ─────────────────────────────────

/** Tab label for Swing. NEVER use "Swing Trade" or "Swing Trading" as a tab. */
export const TAB_LABEL_SWING = "Swing";

/** Tab label for Day. NEVER use "Day Trade" or "Day Trading" as a tab. */
export const TAB_LABEL_DAY = "Day";

/** Tab label for the merged scanner view. Lowercase-d in copy = legal English ("both modes"); */
export const TAB_LABEL_BOTH = "Both";

// ── SECTION / DESK HEADINGS ────────────────────────────────────────────

/** Heading when the surface is the engine personality (dashboard panel, evidence header). */
export const SECTION_LABEL_SWING_DESK = "Swing Desk";

/** Heading when the surface is the engine personality (dashboard panel, evidence header). */
export const SECTION_LABEL_DAY_DESK = "Day Desk";

// ── CADENCE-QUALIFIED SUBHEADINGS ──────────────────────────────────────

/** Subheading when the user needs a reminder of the cadence (Performance page tracks). */
export const SUBHEADING_SWING_CADENCE = "Swing (multi-day cadence)";

/** Subheading when the user needs a reminder of the cadence (Performance page tracks). */
export const SUBHEADING_DAY_CADENCE = "Day (intraday cadence)";

// ── EXPLANATORY PROSE FORMS ────────────────────────────────────────────

/** Prose form for explainer copy ("Swing trading evaluates multi-day setups …"). */
export const PROSE_SWING_TRADING = "swing trading";

/** Prose form for explainer copy ("Day trading evaluates intraday setups …"). */
export const PROSE_DAY_TRADING = "day trading";

// ── OUTCOME TRACKING (signals, NOT trades) ─────────────────────────────

/**
 * Performance / Validation page outcome labels. STOCVEST tracks SIGNALS
 * and resolves them; it does NOT execute trades. So an empty-state line
 * on the Performance page MUST say "Awaiting resolved swing signals" —
 * "Awaiting resolved swing trades" is wrong because no trade was made.
 * This is one of the load-bearing terminology distinctions a future
 * copy-edit pass must not regress.
 */
export const OUTCOME_LABEL_SWING_SIGNALS = "swing signals";

/** See {@link OUTCOME_LABEL_SWING_SIGNALS}. */
export const OUTCOME_LABEL_DAY_SIGNALS = "day signals";

// ── HELPERS ─────────────────────────────────────────────────────────────

/**
 * Compact tab/pill label for a mode. Use this anywhere a mode-segment
 * widget needs a one-word label.
 *
 * @example
 * <button>{tabLabel("swing")}</button>  // → "Swing"
 */
export function tabLabel(mode: TradingMode): string {
  return mode === "swing" ? TAB_LABEL_SWING : TAB_LABEL_DAY;
}

/**
 * Same as {@link tabLabel} but accepts the scanner's three-way mode.
 */
export function scannerTabLabel(mode: ScannerMode): string {
  if (mode === "swing") return TAB_LABEL_SWING;
  if (mode === "day") return TAB_LABEL_DAY;
  return TAB_LABEL_BOTH;
}

/** Section/desk heading label. */
export function deskLabel(mode: TradingMode): string {
  return mode === "swing" ? SECTION_LABEL_SWING_DESK : SECTION_LABEL_DAY_DESK;
}

/** Cadence-qualified subheading. */
export function cadenceLabel(mode: TradingMode): string {
  return mode === "swing" ? SUBHEADING_SWING_CADENCE : SUBHEADING_DAY_CADENCE;
}

/** Outcome label (signals, not trades) for the Performance / Validation surface. */
export function outcomeLabel(mode: TradingMode): string {
  return mode === "swing" ? OUTCOME_LABEL_SWING_SIGNALS : OUTCOME_LABEL_DAY_SIGNALS;
}

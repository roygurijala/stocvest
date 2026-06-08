/**
 * Session-aware copy for the Trading Room market brief.
 *
 * Maps the holiday-aware ET clock (`market-hours-et`) plus the server's
 * authoritative open/closed flag into the four user-facing states the brief
 * needs: live session, pre-market, after-hours, and weekend. Keeps the brief's
 * lead line and empty-desk button honest about *why* there is nothing to act on.
 */
import {
  getEtClock,
  getMarketSessionPhaseEt,
  nextRegularSessionOpenLabel
} from "@/lib/market-hours-et";

export type BriefSessionPhase = "open" | "premarket" | "afterhours" | "weekend" | "closed";

/**
 * Resolve the brief's session phase. The server `marketOpen` flag wins when it
 * says the regular session is open (it is halt/holiday aware); otherwise we lean
 * on the ET wall clock to distinguish pre-market / after-hours / weekend.
 */
export function resolveBriefSessionPhase(marketOpen: boolean | null, now = new Date()): BriefSessionPhase {
  if (marketOpen === true) return "open";
  const { weekday } = getEtClock(now);
  if (weekday === "Sat" || weekday === "Sun") return "weekend";
  const phase = getMarketSessionPhaseEt(now);
  if (phase === "pre") return "premarket";
  if (phase === "post") return "afterhours";
  // Clock says regular hours but the server didn't confirm open — treat as live
  // only when the status is genuinely unknown, else fall through to closed.
  if (phase === "live" && marketOpen === null) return "open";
  return "closed";
}

/** Lead line under "Market pulse", e.g. "Here's where the week ended." */
export function briefSessionSubtitle(phase: BriefSessionPhase): string {
  switch (phase) {
    case "open":
      return "Here's what's happening right now.";
    case "premarket":
      return "Here's what to watch at open.";
    case "weekend":
      return "Here's where the week ended.";
    case "afterhours":
    case "closed":
    default:
      return "Here's how the last session finished.";
  }
}

/** Copy for the primary CTA when the desk has no setup to open. */
export function briefNoSetupLabel(phase: BriefSessionPhase, now = new Date()): string {
  const nextOpen = nextRegularSessionOpenLabel(now);
  switch (phase) {
    case "weekend":
      return `Markets reopen ${nextOpen}`;
    case "afterhours":
    case "closed":
      return `Next session opens ${nextOpen}`;
    case "premarket":
      return `Opens ${nextOpen}`;
    case "open":
    default:
      return "No setups match current conditions";
  }
}

/** Weekend / after-hours are the "preparation" surfaces that show the look-ahead blocks. */
export function isPreparationPhase(phase: BriefSessionPhase): boolean {
  return phase === "weekend" || phase === "afterhours" || phase === "closed";
}

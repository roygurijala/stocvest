import type { SetupJudgment, SetupPhaseId } from "@/lib/signal-evidence/setup-judgment";
import type { TradeDecisionState } from "@/lib/signal-evidence/trade-decision";
import type { SignalsSetupBias } from "@/lib/signals-page-present";

const MAX_HINT_CHARS = 140;

function normalizeWatchForText(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  return trimmed.replace(/^watch for\s+/i, "").replace(/^watch\s+/i, "");
}

function phaseWatchLine(phaseId: SetupPhaseId, bias: SignalsSetupBias): string {
  const phaseWord = phaseId === "exhaustion" ? "Exhausted" : "Extended";
  if (bias === "Neutral") {
    return `${phaseWord} structure — wait for price to reset before layers can align`;
  }
  if (bias === "Bullish") {
    return `${phaseWord} trend — wait for a pullback before the desk can clear`;
  }
  return `${phaseWord} trend — wait for a bounce before the desk can clear`;
}

function hintsOverlap(a: string, b: string): boolean {
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  if (al.includes(bl) || bl.includes(al)) return true;
  const tokens = ["pullback", "extended", "exhaustion", "exhausted", "reset", "rsi"];
  return tokens.some((t) => al.includes(t) && bl.includes(t));
}

/**
 * Plain-English "what to wait for" from setup judgment — desk-only, not trade advice.
 */
export function resolveExecutionWatchHint(
  judgment: SetupJudgment | null | undefined,
  bias: SignalsSetupBias,
  state: TradeDecisionState
): string | null {
  if (state === "actionable") return null;

  if (!judgment) {
    if (bias === "Neutral") {
      return "Wait for layers to agree on direction before the desk can clear";
    }
    return null;
  }

  const phaseId = judgment.setupPhase?.id;
  if (phaseId === "extended" || phaseId === "exhaustion") {
    return phaseWatchLine(phaseId, bias);
  }

  const watchRaw = judgment.watchFor?.trim();
  if (watchRaw) {
    const body = normalizeWatchForText(watchRaw);
    if (body) {
      return body.charAt(0).toUpperCase() + body.slice(1);
    }
  }

  const blockFlag = judgment.tradeability.flags.find((f) => f.severity === "block");
  if (blockFlag && judgment.tradeability.band === "weak") {
    const detail = blockFlag.label.replace(/^RSI\s+[\d.]+\s*—\s*/i, "").trim();
    if (bias === "Neutral") {
      return `Entry timing blocked (${detail.toLowerCase()}) — wait for structure to reset`;
    }
    return `Entry timing blocked — ${detail.toLowerCase()}`;
  }

  if (bias === "Neutral") {
    return "Wait for layers to agree on direction before the desk can clear";
  }

  return null;
}


/** Merge bridge/blocker hint with judgment watch line for command bar + assistant. */
export function mergeExecutionDeskHints(
  primary: string | null | undefined,
  watch: string | null | undefined
): string | null {
  const lead = primary?.trim() || null;
  const tail = watch?.trim() || null;
  if (!lead && !tail) return null;
  if (!lead) return tail && tail.length <= MAX_HINT_CHARS ? tail : tail?.slice(0, MAX_HINT_CHARS) ?? null;
  if (!tail || hintsOverlap(lead, tail)) {
    return lead.length <= MAX_HINT_CHARS ? lead : `${lead.slice(0, MAX_HINT_CHARS - 1)}…`;
  }
  const combined = `${lead} — ${tail}`;
  return combined.length <= MAX_HINT_CHARS ? combined : `${combined.slice(0, MAX_HINT_CHARS - 1)}…`;
}

/**
 * Structure R/R presentation — honest ratios from composite evidence.
 *
 * Headline `risk_reward` may be 0 when geometry fails; never show that as "0.0:1".
 * Prefer `structure_risk_reward` when present and positive.
 */

/** Parse a displayable R/R ratio (> 0). */
export function parsePositiveRiskReward(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

export function parseRiskRewardFromHint(hint: string | null | undefined): number | null {
  const t = hint?.trim();
  if (!t) return null;
  const m = t.match(/\((\d+(?:\.\d+)?)\s*:\s*1\)/i) ?? t.match(/(\d+(?:\.\d+)?)\s*:\s*1/i);
  if (!m) return null;
  return parsePositiveRiskReward(Number(m[1]));
}

export function resolveStructureRiskReward(input: {
  risk_reward?: unknown;
  structure_risk_reward?: unknown;
  execution_hint?: string | null;
}): number | null {
  const fromStructure = parsePositiveRiskReward(input.structure_risk_reward);
  if (fromStructure != null) return fromStructure;
  const fromHeadline = parsePositiveRiskReward(input.risk_reward);
  if (fromHeadline != null) return fromHeadline;
  return parseRiskRewardFromHint(input.execution_hint ?? null);
}

/** Card / list line for structure R/R at the current price. */
export function formatRiskRewardLine(
  rr: number | null | undefined,
  opts?: { atCurrentPrice?: boolean; minGate?: number | null }
): string | null {
  if (rr == null || !Number.isFinite(rr) || rr <= 0) return null;
  const atCurrent = opts?.atCurrentPrice !== false;
  const base = atCurrent ? `R/R at current price ${rr.toFixed(1)}:1` : `R/R ${rr.toFixed(1)}:1`;
  const min = opts?.minGate;
  if (min != null && Number.isFinite(min) && min > 0) {
    return rr >= min
      ? `${base} — clears ${min.toFixed(1)}:1 gate`
      : `${base} — below ${min.toFixed(1)}:1 gate`;
  }
  return base;
}

/** Secondary line when entry-zone edge R/R differs from current-price structure R/R. */
export function formatEntryZoneRrLine(rr: number | null | undefined): string | null {
  if (rr == null || !Number.isFinite(rr) || rr <= 0) return null;
  return `At entry zone top ${rr.toFixed(1)}:1`;
}

/** Inputs for page decision / trade conviction from a composite body. */
export function resolveCompositeRiskRewardForDecision(
  body: Record<string, unknown>,
  minGate: number
): { riskReward: number; rrWarning: boolean; structureRr: number | null } {
  const structureRr = parsePositiveRiskReward(body.structure_risk_reward);
  const headlineRr = parsePositiveRiskReward(body.risk_reward);
  const riskReward = structureRr ?? headlineRr ?? 0;
  const rrWarning =
    Boolean(body.rr_warning) ||
    structureRr == null ||
    riskReward <= 0 ||
    riskReward < minGate;
  return { riskReward, rrWarning, structureRr };
}

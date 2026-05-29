/** Risk/reward from reference entry, stop, and targets — keep in sync with `risk_reward_structure.py`. */

export function roundRiskRewardDisplay(rr: number): number {
  return Math.round(Math.min(10, Math.max(0, rr)) * 10) / 10;
}

export function rrFromLevelsLong(entry: number, target: number, stop: number): number | null {
  const risk = entry - stop;
  const reward = target - entry;
  if (risk <= 1e-6 || reward <= 1e-6) return null;
  return reward / risk;
}

export function rrFromLevelsShort(entry: number, target: number, stop: number): number | null {
  const risk = stop - entry;
  const reward = entry - target;
  if (risk <= 1e-6 || reward <= 1e-6) return null;
  return reward / risk;
}

export function structureRiskRewardLong(
  entry: number,
  target1: number,
  stop: number,
  target2?: number | null
): number | null {
  const rrT1 = rrFromLevelsLong(entry, target1, stop);
  if (target2 == null || !Number.isFinite(target2)) return rrT1;
  const rrT2 = rrFromLevelsLong(entry, target2, stop);
  if (rrT1 == null) return rrT2;
  if (rrT2 == null) return rrT1;
  if (rrT1 < 1.0 && rrT2 > rrT1) return rrT2;
  return rrT1;
}

export function structureRiskRewardShort(
  entry: number,
  target1: number,
  stop: number,
  target2?: number | null
): number | null {
  const rrT1 = rrFromLevelsShort(entry, target1, stop);
  if (target2 == null || !Number.isFinite(target2)) return rrT1;
  const rrT2 = rrFromLevelsShort(entry, target2, stop);
  if (rrT1 == null) return rrT2;
  if (rrT2 == null) return rrT1;
  if (rrT1 < 1.0 && rrT2 > rrT1) return rrT2;
  return rrT1;
}

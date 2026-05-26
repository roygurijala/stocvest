import {
  resolveScenarioLevels,
  type ScenarioPresetId,
  type ScenarioVariantCatalog
} from "@/lib/scenario/scenario-variants";

/** Treat entry/stop/target as equal when within half a cent (display rounds to cents). */
export const SCENARIO_LEVEL_MATCH_EPS = 0.005;

export type ScenarioComparisonRow = {
  id: ScenarioPresetId | "your_draft";
  label: string;
  entry: number;
  stop: number;
  target: number;
  riskReward: number | null;
};

const PRESET_LABELS: Record<ScenarioPresetId, string> = {
  default: "System default",
  conservative: "Conservative",
  aggressive: "Aggressive"
};

export function scenarioGeometryLevelsMatch(
  a: { entry: number; stop: number; target: number },
  b: { entry: number; stop: number; target: number },
  epsilon = SCENARIO_LEVEL_MATCH_EPS
): boolean {
  return (
    Math.abs(a.entry - b.entry) <= epsilon &&
    Math.abs(a.stop - b.stop) <= epsilon &&
    Math.abs(a.target - b.target) <= epsilon
  );
}

export function computeUserScenarioRiskReward(
  catalog: ScenarioVariantCatalog,
  userEntry: number,
  userStop: number,
  userTarget: number
): number | null {
  if (!Number.isFinite(userEntry) || !Number.isFinite(userStop) || !Number.isFinite(userTarget)) {
    return null;
  }
  const dir = catalog.source.direction;
  if (dir === "bullish") {
    const risk = userEntry - userStop;
    const reward = userTarget - userEntry;
    if (risk <= 1e-6 || reward <= 1e-6) return null;
    return Math.round((reward / risk) * 100) / 100;
  }
  const risk = userStop - userEntry;
  const reward = userEntry - userTarget;
  if (risk <= 1e-6 || reward <= 1e-6) return null;
  return Math.round((reward / risk) * 100) / 100;
}

export function buildScenarioComparisonRows(
  catalog: ScenarioVariantCatalog,
  userEntry: number,
  userStop: number,
  userTarget: number
): ScenarioComparisonRow[] {
  const rows: ScenarioComparisonRow[] = [];
  let systemDefault: { entry: number; stop: number; target: number } | null = null;

  for (const preset of ["default", "conservative", "aggressive"] as ScenarioPresetId[]) {
    const selection = catalog.presets[preset];
    const resolved = resolveScenarioLevels(catalog.source, selection);
    if (!resolved) continue;
    if (preset === "default") {
      systemDefault = resolved;
    }
    rows.push({
      id: preset,
      label: PRESET_LABELS[preset],
      entry: resolved.entry,
      stop: resolved.stop,
      target: resolved.target,
      riskReward: resolved.riskReward
    });
  }

  const userLevels = { entry: userEntry, stop: userStop, target: userTarget };
  const matchesSystemDefault =
    systemDefault != null && scenarioGeometryLevelsMatch(userLevels, systemDefault);

  if (!matchesSystemDefault) {
    rows.push({
      id: "your_draft",
      label: "Your draft",
      entry: userEntry,
      stop: userStop,
      target: userTarget,
      riskReward: computeUserScenarioRiskReward(catalog, userEntry, userStop, userTarget)
    });
  }

  return rows;
}

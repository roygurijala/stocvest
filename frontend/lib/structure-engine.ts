/**
 * Unified structure engine (B80) — clustered support/resistance zones.
 * Keep in sync with stocvest/api/services/structure_engine.py.
 */

export type DailyBar = { low: number; high: number };

export type LevelZone = {
  level: number;
  touchCount: number;
  recency: number;
  strength: number;
};

const TINY = 1e-6;
const BASE_WINDOW_ATR = 2.0;
const MAX_CANDIDATES = 5;

const DESK_PARAMS: Record<string, { t1Alpha: number; t1Beta: number; t2Beta: number }> = {
  day: { t1Alpha: 0.8, t1Beta: 2.0, t2Beta: 2.5 },
  swing: { t1Alpha: 1.5, t1Beta: 3.0, t2Beta: 4.0 }
};

export function deskGeometryParams(tradingMode: string): { t1Alpha: number; t1Beta: number; t2Beta: number } {
  return String(tradingMode).trim().toLowerCase() === "day" ? DESK_PARAMS.day : DESK_PARAMS.swing;
}

export function candidateWindowAtr(tradingMode: string): number {
  return Math.max(BASE_WINDOW_ATR, deskGeometryParams(tradingMode).t1Beta);
}

export function adaptiveEpsilon(atr: number, price: number): number {
  return Math.max(0.3 * atr, Math.abs(price) * 0.002);
}

function barExtremesWithRecency(
  dailyBars: DailyBar[] | null | undefined,
  key: "low" | "high"
): Array<[number, number]> {
  if (!dailyBars?.length) return [];
  const out: Array<[number, number]> = [];
  const n = dailyBars.length;
  const denom = n > 1 ? n - 1 : 1;
  for (let i = 0; i < n; i++) {
    const v = dailyBars[i][key];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) {
      out.push([v, n > 1 ? i / denom : 1]);
    }
  }
  return out;
}

function positiveLevels(rawLevels: Array<number | null | undefined>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const raw of rawLevels) {
    if (raw == null || !Number.isFinite(raw) || raw <= 0) continue;
    out.push([raw, 1]);
  }
  return out;
}

function clusterLevelPoints(
  points: Array<[number, number]>,
  epsilon: number,
  edge: "low" | "high"
): LevelZone[] {
  if (!points.length) return [];
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  const clusters: Array<Array<[number, number]>> = [[pts[0]]];
  for (let i = 1; i < pts.length; i++) {
    const [level, recency] = pts[i];
    if (level - clusters[clusters.length - 1][clusters[clusters.length - 1].length - 1][0] <= epsilon + TINY) {
      clusters[clusters.length - 1].push([level, recency]);
    } else {
      clusters.push([[level, recency]]);
    }
  }
  const zones: LevelZone[] = [];
  for (const members of clusters) {
    const levels = members.map((m) => m[0]);
    const rep = edge === "low" ? Math.min(...levels) : Math.max(...levels);
    const touchCount = members.length;
    const recency = Math.max(...members.map((m) => m[1]));
    zones.push({
      level: Math.round(rep * 10000) / 10000,
      touchCount,
      recency,
      strength: touchCount + recency
    });
  }
  return zones;
}

export function resistanceZones(opts: {
  reference: number;
  atr: number;
  dailyBars: DailyBar[] | null | undefined;
  extraLevels?: Array<number | null | undefined>;
  windowAtr: number;
}): LevelZone[] {
  const { reference, atr, dailyBars, extraLevels = [], windowAtr } = opts;
  const points = barExtremesWithRecency(dailyBars, "high");
  points.push(...positiveLevels(extraLevels));
  const epsilon = adaptiveEpsilon(atr, reference);
  const zones = clusterLevelPoints(points, epsilon, "low");
  const hiCap = reference + windowAtr * atr;
  const above = zones.filter((z) => z.level > reference + TINY && z.level <= hiCap + TINY);
  above.sort((a, b) => a.level - reference - (b.level - reference));
  return above.slice(0, MAX_CANDIDATES);
}

export function supportZones(opts: {
  reference: number;
  atr: number;
  dailyBars: DailyBar[] | null | undefined;
  extraLevels?: Array<number | null | undefined>;
  windowAtr: number;
}): LevelZone[] {
  const { reference, atr, dailyBars, extraLevels = [], windowAtr } = opts;
  const points = barExtremesWithRecency(dailyBars, "low");
  points.push(...positiveLevels(extraLevels));
  const epsilon = adaptiveEpsilon(atr, reference);
  const zones = clusterLevelPoints(points, epsilon, "high");
  const loCap = reference - windowAtr * atr;
  const below = zones.filter((z) => z.level < reference - TINY && z.level >= loCap - TINY);
  below.sort((a, b) => reference - a.level - (reference - b.level));
  return below.slice(0, MAX_CANDIDATES);
}

export function nearestResistanceAbove(opts: {
  last: number;
  floorAbove: number;
  atr: number;
  dailyBars: DailyBar[] | null | undefined;
  tradingMode?: string;
  extraLevels?: Array<number | null | undefined>;
}): LevelZone | null {
  const { last, floorAbove, atr, dailyBars, tradingMode = "swing", extraLevels } = opts;
  if (last <= 0 || floorAbove <= 0 || atr <= 0) return null;
  const window = candidateWindowAtr(tradingMode);
  const zones = resistanceZones({ reference: last, atr, dailyBars, extraLevels, windowAtr: window });
  const eligible = zones.filter((z) => z.level > floorAbove + TINY && z.level > last + TINY);
  if (!eligible.length) return null;
  return eligible.reduce((best, z) => (z.level < best.level ? z : best));
}

export function nearestSupportBelow(opts: {
  last: number;
  ceilingBelow: number;
  atr: number;
  dailyBars: DailyBar[] | null | undefined;
  tradingMode?: string;
  extraLevels?: Array<number | null | undefined>;
}): LevelZone | null {
  const { last, ceilingBelow, atr, dailyBars, tradingMode = "swing", extraLevels } = opts;
  if (last <= 0 || ceilingBelow <= 0 || atr <= 0) return null;
  const window = candidateWindowAtr(tradingMode);
  const zones = supportZones({ reference: last, atr, dailyBars, extraLevels, windowAtr: window });
  const eligible = zones.filter((z) => z.level < ceilingBelow - TINY && z.level < last - TINY);
  if (!eligible.length) return null;
  return eligible.reduce((best, z) => (z.level > best.level ? z : best));
}

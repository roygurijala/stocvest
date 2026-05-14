/**
 * Server-computed Gap Intelligence snapshot (`GET /v1/signals/gap-intel`).
 * Shapes mirror `stocvest.signals.gap_intel_snapshot.build_gap_intel_snapshot`.
 */

export type GapIntelPhaseState =
  | "MARKET_CLOSED"
  | "OFF_PRE"
  | "PRE_MARKET"
  | "SESSION_OPEN"
  | "SESSION"
  | "AFTER_HOURS"
  | "OFF_POST";

export type GapIntelScenarioBuilderState = "DISABLED" | "LIMITED" | "ENABLED";

export interface GapIntelSnapshot {
  symbol: string;
  session_date: string;
  computed_at_utc: string;
  phase: {
    state: GapIntelPhaseState;
    label: string;
    window_start_et: string;
    window_end_et: string;
    cadence_seconds: number;
  };
  gap: {
    direction: "UP" | "DOWN" | "NONE" | "UNKNOWN";
    status: string;
    resolution_state: string;
    gap_size_pct: number | null;
  };
  levels: {
    fill_level: number | null;
    fill_source: string;
    fill_reliability: string;
  };
  liquidity: { is_high_liquidity: boolean; detail: Record<string, unknown> };
  scenario_builder: { state: GapIntelScenarioBuilderState; reasons: string[] };
  flags: {
    calendar_state: string;
    stale: boolean;
    market_closed: boolean;
  };
  disclaimer?: string;
}

const GAP_INTEL_PHASE_STATES: ReadonlySet<string> = new Set([
  "MARKET_CLOSED",
  "OFF_PRE",
  "PRE_MARKET",
  "SESSION_OPEN",
  "SESSION",
  "AFTER_HOURS",
  "OFF_POST"
]);

const GAP_INTEL_SCENARIO_STATES: ReadonlySet<string> = new Set(["DISABLED", "LIMITED", "ENABLED"]);

const GAP_DIRECTIONS: ReadonlySet<string> = new Set(["UP", "DOWN", "NONE", "UNKNOWN"]);

/**
 * Accept only a server-shaped snapshot so tests' `{}` catch-alls and partial JSON
 * never crash Layers / Evidence / assistant narrowing.
 */
export function parseGapIntelSnapshot(raw: unknown): GapIntelSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const symbol = typeof o.symbol === "string" ? o.symbol.trim() : "";
  const session_date = typeof o.session_date === "string" ? o.session_date : "";
  const computed_at_utc = typeof o.computed_at_utc === "string" ? o.computed_at_utc : "";
  if (!symbol || !session_date || !computed_at_utc) return null;

  const phase = o.phase;
  if (!phase || typeof phase !== "object") return null;
  const ph = phase as Record<string, unknown>;
  const phaseState = typeof ph.state === "string" ? ph.state : "";
  if (!GAP_INTEL_PHASE_STATES.has(phaseState)) return null;
  const phaseLabel = typeof ph.label === "string" ? ph.label : "";
  const window_start_et = typeof ph.window_start_et === "string" ? ph.window_start_et : "";
  const window_end_et = typeof ph.window_end_et === "string" ? ph.window_end_et : "";
  const cadence_seconds = typeof ph.cadence_seconds === "number" && Number.isFinite(ph.cadence_seconds) ? ph.cadence_seconds : NaN;
  if (!phaseLabel || !window_start_et || !window_end_et || cadence_seconds < 0) return null;

  const gap = o.gap;
  if (!gap || typeof gap !== "object") return null;
  const g = gap as Record<string, unknown>;
  const direction = typeof g.direction === "string" ? g.direction : "";
  if (!GAP_DIRECTIONS.has(direction)) return null;
  const status = typeof g.status === "string" ? g.status : "";
  const resolution_state = typeof g.resolution_state === "string" ? g.resolution_state : "";
  if (!status || !resolution_state) return null;
  const gap_size_pct =
    g.gap_size_pct === null
      ? null
      : typeof g.gap_size_pct === "number" && Number.isFinite(g.gap_size_pct)
        ? g.gap_size_pct
        : null;

  const levels = o.levels;
  if (!levels || typeof levels !== "object") return null;
  const lv = levels as Record<string, unknown>;
  const fill_source = typeof lv.fill_source === "string" ? lv.fill_source : "";
  const fill_reliability = typeof lv.fill_reliability === "string" ? lv.fill_reliability : "";
  if (!fill_source || !fill_reliability) return null;
  const fill_level =
    lv.fill_level === null
      ? null
      : typeof lv.fill_level === "number" && Number.isFinite(lv.fill_level)
        ? lv.fill_level
        : null;

  const liquidity = o.liquidity;
  if (!liquidity || typeof liquidity !== "object") return null;
  const liq = liquidity as Record<string, unknown>;
  if (typeof liq.is_high_liquidity !== "boolean") return null;
  const detail =
    liq.detail && typeof liq.detail === "object" && !Array.isArray(liq.detail)
      ? (liq.detail as Record<string, unknown>)
      : {};

  const scenario_builder = o.scenario_builder;
  if (!scenario_builder || typeof scenario_builder !== "object") return null;
  const sb = scenario_builder as Record<string, unknown>;
  const sbState = typeof sb.state === "string" ? sb.state : "";
  if (!GAP_INTEL_SCENARIO_STATES.has(sbState)) return null;
  const reasons = Array.isArray(sb.reasons) ? sb.reasons.filter((r): r is string => typeof r === "string") : [];

  const flags = o.flags;
  if (!flags || typeof flags !== "object") return null;
  const fl = flags as Record<string, unknown>;
  const calendar_state = typeof fl.calendar_state === "string" ? fl.calendar_state : "";
  if (!calendar_state || typeof fl.stale !== "boolean" || typeof fl.market_closed !== "boolean") return null;

  const disclaimer = typeof o.disclaimer === "string" ? o.disclaimer : undefined;

  return {
    symbol,
    session_date,
    computed_at_utc,
    phase: {
      state: phaseState as GapIntelPhaseState,
      label: phaseLabel,
      window_start_et,
      window_end_et,
      cadence_seconds
    },
    gap: {
      direction: direction as GapIntelSnapshot["gap"]["direction"],
      status,
      resolution_state,
      gap_size_pct
    },
    levels: {
      fill_level,
      fill_source,
      fill_reliability
    },
    liquidity: { is_high_liquidity: liq.is_high_liquidity, detail },
    scenario_builder: { state: sbState as GapIntelScenarioBuilderState, reasons },
    flags: {
      calendar_state,
      stale: fl.stale,
      market_closed: fl.market_closed
    },
    disclaimer
  };
}
